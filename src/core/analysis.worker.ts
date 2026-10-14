/**
 * 分析 Worker：解码后的像元级计算全部在此线程执行。
 * 两条管线：
 * - 染色预设（h_dab / h_eosin / masson）：去卷积 → 背景扣除 → 阈值 → 核分割 → 指标
 * - IF 共定位（if_coloc）：逐通道背景扣除与阈值 → 掩膜 Pearson + Manders
 * 通过 requestId 丢弃过期结果；UI 持有最新请求即可。
 */
import { buildStainMatrix, extractStainChannel } from './image/color.ts';
import { buildOverlay, clipRect, computeAreaMetrics } from './analysis/metrics.ts';
import { computeAutoThreshold, histogram256, percentileFromHist } from './analysis/threshold.ts';
import { buildColocOverlayRgba, computeColocalization } from './analysis/colocalize.ts';
import {
  connectedComponents,
  gateComponents,
  meanChannelOverComponent,
  summarizeComponents,
} from './analysis/segment.ts';
import { ensureSession, cachedModelName, inferNucleiProb } from './ai/session.ts';
import { probToMask } from './ai/prepost.ts';
import { getStainProfile } from './types.ts';
import type { Vec3 } from './types.ts';
import type {
  AnalysisResult,
  Calibration,
  ColocConfig,
  ColocResult,
  Roi,
  RoiMetrics,
  SegmentationConfig,
  StainProfileId,
  ThresholdConfig,
} from './types.ts';

export interface AnalysisRequest {
  requestId: number;
  pixels: ImageData;
  rois: Roi[];
  profileId: StainProfileId;
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  calibration: Calibration;
  coloc: ColocConfig;
  /** 用户自定义染色向量（null = 预设默认） */
  stainOverride: [Vec3, Vec3] | null;
  /** AI 核分割：useAi 开启且带 model 字节时（按名）装载会话 */
  ai: { useAi: boolean; model: { name: string; bytes: ArrayBuffer } | null };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
}

const workerSelf = self as unknown as WorkerScope & {
  postMessage: (message: AnalysisResult) => void;
};

workerSelf.onmessage = async (event) => {
  const request = event.data;
  const result = request.profileId === 'if_coloc'
    ? runColocAnalysis(request)
    : await runStainAnalysis(request);
  workerSelf.postMessage(result);
};

function estimateTotal(count: number, borderCount: number): number {
  if (count <= 0) return 0;
  const value = count + (borderCount * count) / (count + borderCount);
  return Math.round(value * 10) / 10;
}

// ── 染色预设管线 ──

async function runStainAnalysis(request: AnalysisRequest): Promise<AnalysisResult> {
  const { requestId, pixels, rois, profileId, threshold, segmentation, calibration } = request;
  const warnings: string[] = [];
  const { width, height } = pixels;
  const profile = getStainProfile(profileId);

  // 1. 去卷积 → 定量通道 / 核复染通道（第一染色）；用户自定义向量优先，奇异时回落预设
  let stainPair = request.stainOverride ?? profile.stains!;
  let matrix: ReturnType<typeof buildStainMatrix>;
  try {
    matrix = buildStainMatrix(stainPair[0], stainPair[1]);
  } catch {
    warnings.push('自定义染色向量近乎共线，已回落为预设向量。');
    stainPair = profile.stains!;
    matrix = buildStainMatrix(stainPair[0], stainPair[1]);
  }
  const quantified = extractStainChannel(pixels, matrix, profile.quantifyChannel);
  const nuclearSource = extractStainChannel(pixels, matrix, 0);

  // 2. 定量通道背景扣除
  const fullHist = histogram256(quantified);
  const backgroundLevel = percentileFromHist(fullHist, threshold.backgroundPercentile);
  for (let i = 0; i < quantified.length; i += 1) {
    const v = quantified[i] - backgroundLevel;
    quantified[i] = v > 0 ? v : 0;
  }

  // 3. 阈值解析
  let thresholdUsed: number;
  if (threshold.mode === 'manual') {
    thresholdUsed = Math.min(255, Math.max(0, Math.round(threshold.manualValue)));
  } else if (threshold.mode === 'control' && threshold.controlThreshold !== null) {
    thresholdUsed = threshold.controlThreshold;
  } else {
    if (threshold.mode === 'control') {
      warnings.push('对照片尚未标定，本次使用 Otsu 自动阈值。');
    }
    thresholdUsed = computeAutoThreshold(histogram256(quantified), threshold.method);
  }

  // 4. 核分割：AI 概率图（可选，失败自动回落）或第一染色通道逐图 Otsu
  let nuclearMask: Uint8Array = new Uint8Array(quantified.length);
  let nuclearThresholdUsed = -1;
  let aiUsed = false;
  let aiModelLoaded: string | null = cachedModelName();
  if (request.ai?.useAi) {
    try {
      if (request.ai.model && cachedModelName() !== request.ai.model.name) {
        aiModelLoaded = null;
        await ensureSession(request.ai.model.name, request.ai.model.bytes);
      }
      const prob = await inferNucleiProb(nuclearSource, width, height);
      nuclearMask = probToMask(prob, 0.5);
      nuclearThresholdUsed = -1; // AI 概率图阈值 0.5，无 OD 阈值语义
      aiUsed = true;
      aiModelLoaded = cachedModelName();
    } catch (error) {
      warnings.push(`AI 核分割失败，已回落 Otsu：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!aiUsed) {
    nuclearThresholdUsed = computeAutoThreshold(histogram256(nuclearSource), 'otsu');
    nuclearMask = new Uint8Array(quantified.length);
    for (let i = 0; i < nuclearSource.length; i += 1) {
      nuclearMask[i] = nuclearSource[i] > nuclearThresholdUsed ? 1 : 0;
    }
  }
  const allComponents = connectedComponents(nuclearMask, width, height);
  const { kept: nuclei } = gateComponents(allComponents, segmentation);
  if (nuclei.length === 0 && allComponents.length > 0) {
    warnings.push('门控参数滤除了全部分割目标，请调整面积/圆度范围。');
  }

  // 5. 每个核的阳性判定：核内平均定量通道 OD > 阈值
  interface Nucleus {
    cx: number;
    cy: number;
    positive: boolean;
    touchesBorder: boolean;
  }
  const nucleusList: Nucleus[] = nuclei.map((component) => {
    let seed = Math.round(component.cy) * width + Math.round(component.cx);
    if (nuclearMask[seed] === 0) {
      const cx = Math.round(component.cx);
      const cy = Math.round(component.cy);
      outer: for (let radius = 1; radius <= 6; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const index = y * width + x;
            if (nuclearMask[index] === 1) {
              seed = index;
              break outer;
            }
          }
        }
      }
    }
    const meanValue =
      nuclearMask[seed] === 1 ? meanChannelOverComponent(quantified, width, nuclearMask, seed) : 0;
    return {
      cx: component.cx,
      cy: component.cy,
      positive: meanValue > thresholdUsed,
      touchesBorder: component.touchesBorder,
    };
  });

  const totalSummary = summarizeComponents(nuclei);
  const positiveCount = nucleusList.reduce((sum, item) => sum + (item.positive ? 1 : 0), 0);
  const positiveBorder = nucleusList.reduce(
    (sum, item) => sum + (item.positive && item.touchesBorder ? 1 : 0),
    0,
  );
  const mpp = calibration?.mpp ?? null;
  const areaMm2Safe = mpp !== null ? (width * height * mpp * mpp) / 1e6 : null;

  const fullRect = clipRect({ x: 0, y: 0, w: width, h: height }, width, height);
  const overall = fillNuclei(
    computeAreaMetrics(quantified, width, fullRect, thresholdUsed, {
      roiId: null,
      roiName: '整图',
    }),
    {
      positiveNuclei: positiveCount,
      totalNuclei: totalSummary.count,
      borderNuclei: positiveBorder,
      labelingIndex: totalSummary.count > 0 ? positiveCount / totalSummary.count : null,
      estimatedTotalCount: estimateTotal(totalSummary.count, totalSummary.borderCount),
      densityPerMm2: areaMm2Safe !== null ? totalSummary.estimatedTotal / areaMm2Safe : null,
    },
  );

  const perRoi = rois.map((roi) => {
    const rect = clipRect(roi, width, height);
    const inside = nucleusList.filter(
      (item) => item.cx >= rect.x && item.cx < rect.x + rect.w && item.cy >= rect.y && item.cy < rect.y + rect.h,
    );
    const roiTotal = inside.length;
    const roiPositive = inside.reduce((sum, item) => sum + (item.positive ? 1 : 0), 0);
    const roiEstimated = estimateTotal(roiTotal, inside.reduce((sum, item) => sum + (item.touchesBorder ? 1 : 0), 0));
    const roiAreaMm2 = mpp !== null ? (rect.w * rect.h * mpp * mpp) / 1e6 : null;
    return fillNuclei(
      computeAreaMetrics(quantified, width, rect, thresholdUsed, {
        roiId: roi.id,
        roiName: roi.name,
      }),
      {
        positiveNuclei: roiPositive,
        totalNuclei: roiTotal,
        borderNuclei: inside.reduce(
          (sum, item) => sum + (item.positive && item.touchesBorder ? 1 : 0),
          0,
        ),
        labelingIndex: roiTotal > 0 ? roiPositive / roiTotal : null,
        estimatedTotalCount: roiEstimated,
        densityPerMm2: roiAreaMm2 !== null && roiAreaMm2 > 0 ? roiEstimated / roiAreaMm2 : null,
      },
    );
  });

  const overlay = buildOverlay(quantified, width, height, thresholdUsed);

  return {
    requestId,
    overall,
    perRoi,
    thresholdUsed,
    nuclearThresholdUsed,
    backgroundLevel,
    overlay,
    coloc: null,
    aiUsed,
    aiModelLoaded,
    warnings,
  };
}

// ── IF 共定位管线 ──

function runColocAnalysis(request: AnalysisRequest): AnalysisResult {
  const { requestId, pixels, coloc } = request;
  const warnings: string[] = [];
  const colocResult: ColocResult = computeColocalization(pixels, coloc);

  const rawA = channelData(pixels, coloc.channelA);
  const rawB = channelData(pixels, coloc.channelB);
  for (let i = 0; i < rawA.length; i += 1) {
    rawA[i] = Math.max(0, rawA[i] - colocResult.backgroundA);
    rawB[i] = Math.max(0, rawB[i] - colocResult.backgroundB);
  }
  const overlayRgba = buildColocOverlayRgba(rawA, rawB, colocResult.thresholdA, colocResult.thresholdB);
  const overlay = new ImageData(new Uint8ClampedArray(overlayRgba), pixels.width, pixels.height);

  const metrics: RoiMetrics = {
    roiId: null,
    roiName: '整图',
    pixelCount: pixels.width * pixels.height,
    positiveFraction: colocResult.mandersM1,
    positiveNuclei: 0,
    totalNuclei: 0,
    labelingIndex: null,
    borderNuclei: 0,
    integratedOpticalDensity: 0,
    meanOpticalDensity: null,
    estimatedTotalCount: null,
    densityPerMm2: null,
  };
  return {
    requestId,
    overall: metrics,
    perRoi: [],
    thresholdUsed: colocResult.thresholdA,
    nuclearThresholdUsed: colocResult.thresholdB,
    backgroundLevel: colocResult.backgroundA,
    overlay,
    coloc: colocResult,
    aiUsed: false,
    aiModelLoaded: null,
    warnings,
  };
}

function channelData(pixels: ImageData, channel: 0 | 1 | 2): Float32Array {
  const out = new Float32Array(pixels.width * pixels.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = pixels.data[p + channel];
  }
  return out;
}

function fillNuclei(base: RoiMetrics, nuclei: Partial<RoiMetrics>): RoiMetrics {
  return { ...base, ...nuclei };
}
