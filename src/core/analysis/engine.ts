/**
 * 纯分析引擎：染色预设与 IF 共定位两条管线的唯一实现。
 * 无 DOM、无 Worker 依赖（node 可测），Worker 与程序化 API（core/api.ts）共用。
 */
import { buildStainMatrix, extractStainChannel, type RgbaPixels } from '../image/color.ts';
import { buildOverlayRgba, clipRect, computeAreaMetrics } from './metrics.ts';
import { computeAutoThreshold, histogram256, percentileFromHist } from './threshold.ts';
import {
  connectedComponents,
  gateComponents,
  meanChannelOverComponent,
  summarizeComponents,
} from './segment.ts';
import { computeColocalization, buildColocOverlayRgba } from './colocalize.ts';
import { getStainProfile } from '../types.ts';
import type {
  Calibration,
  Roi,
  RoiMetrics,
  SegmentationConfig,
  StainProfileId,
  ThresholdConfig,
  Vec3,
} from '../types.ts';

export interface EngineInput {
  pixels: RgbaPixels;
  rois: Roi[];
  profileId: StainProfileId;
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  calibration: Calibration;
  /** 用户自定义染色向量（null = 预设默认） */
  stainOverride: [Vec3, Vec3] | null;
  /** AI 核掩膜（长度 = w*h，0/1）；提供时替代苏木精 Otsu 掩膜 */
  aiMask?: Uint8Array | null;
}

export interface EngineQc {
  /** 组织占比：原始 OD > 10 的像素比例 */
  tissueFraction: number;
  /** 饱和像素比例（RGB 全 ≥250） */
  saturatedFraction: number;
  /** Otsu 分离度 |μfg−μbg|/(σfg+σbg)，<0.35 提示阈值不可靠 */
  otsuSeparation: number;
  /** 门控拒绝统计 */
  rejectedByArea: number;
  rejectedByCircularity: number;
  /** 全部核中触边比例（0–1） */
  borderFraction: number;
}

export interface StainEngineResult {
  overall: RoiMetrics;
  perRoi: RoiMetrics[];
  thresholdUsed: number;
  nuclearThresholdUsed: number;
  backgroundLevel: number;
  overlayRgba: Uint8ClampedArray;
  warnings: string[];
  qc: EngineQc;
}

function estimateTotal(count: number, borderCount: number): number {
  if (count <= 0) return 0;
  const value = count + (borderCount * count) / (count + borderCount);
  return Math.round(value * 10) / 10;
}

export function analyzeStainImage(input: EngineInput): StainEngineResult {
  const { pixels, rois, profileId, threshold, segmentation, calibration } = input;
  const warnings: string[] = [];
  const { width, height } = pixels;
  const profile = getStainProfile(profileId);

  // 1. 去卷积 → 定量通道 / 核复染通道（第一染色）；用户自定义向量优先，奇异时回落预设
  let stainPair = input.stainOverride ?? profile.stains!;
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

  // QC：饱和与组织占比（扣除前统计）
  let saturated = 0;
  let tissue = 0;
  for (let i = 0, p = 0; i < quantified.length; i += 1, p += 4) {
    const rgb = pixels.data;
    if (rgb[p] >= 250 && rgb[p + 1] >= 250 && rgb[p + 2] >= 250) saturated += 1;
    if (quantified[i] > 10) tissue += 1;
  }
  const total = quantified.length;

  // 2. 背景扣除
  const fullHist = histogram256(quantified);
  const backgroundLevel = percentileFromHist(fullHist, threshold.backgroundPercentile);
  for (let i = 0; i < quantified.length; i += 1) {
    const v = quantified[i] - backgroundLevel;
    quantified[i] = v > 0 ? v : 0;
  }

  // 3. 阈值解析 + Otsu 分离度
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
  const sepHist = histogram256(quantified);
  const otsuT = computeAutoThreshold(sepHist, 'otsu');
  let wB = 0;
  let sB = 0;
  let grand = 0;
  let count = 0;
  for (let i = 0; i < 256; i += 1) {
    count += sepHist[i];
    grand += sepHist[i] * i;
  }
  for (let i = 0; i <= otsuT && i < 256; i += 1) {
    wB += sepHist[i];
    sB += sepHist[i] * i;
  }
  const meanB = wB > 0 ? sB / wB : 0;
  const meanF = count - wB > 0 ? (grand - sB) / (count - wB) : 0;
  let vB = 0;
  let vF = 0;
  for (let i = 0; i <= otsuT && i < 256; i += 1) vB += sepHist[i] * (i - meanB) ** 2;
  for (let i = otsuT + 1; i < 256; i += 1) vF += sepHist[i] * (i - meanF) ** 2;
  const sdB = wB > 0 ? Math.sqrt(vB / Math.max(1, wB)) : 0;
  const sdF = count - wB > 0 ? Math.sqrt(vF / Math.max(1, count - wB)) : 0;
  const otsuSeparation =
    sdB + sdF > 0 ? Math.abs(meanF - meanB) / (sdB + sdF) : 0;

  // 4. 核分割：AI 掩膜（可选）或第一染色通道逐图 Otsu
  let nuclearMask: Uint8Array;
  let nuclearThresholdUsed: number;
  if (input.aiMask && input.aiMask.length === quantified.length) {
    nuclearMask = input.aiMask;
    nuclearThresholdUsed = -1;
  } else {
    if (input.aiMask) warnings.push('AI 掩膜尺寸不符，已回落 Otsu。');
    nuclearThresholdUsed = computeAutoThreshold(histogram256(nuclearSource), 'otsu');
    nuclearMask = new Uint8Array(quantified.length);
    for (let i = 0; i < nuclearSource.length; i += 1) {
      nuclearMask[i] = nuclearSource[i] > nuclearThresholdUsed ? 1 : 0;
    }
  }
  const allComponents = connectedComponents(nuclearMask, width, height);
  const { kept: nuclei, rejectedArea, rejectedCircularity } = gateComponents(allComponents, segmentation);
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

  return {
    overall,
    perRoi,
    thresholdUsed,
    nuclearThresholdUsed,
    backgroundLevel,
    overlayRgba: buildOverlayRgba(quantified, thresholdUsed),
    warnings,
    qc: {
      tissueFraction: total > 0 ? tissue / total : 0,
      saturatedFraction: total > 0 ? saturated / total : 0,
      otsuSeparation: Math.round(otsuSeparation * 1000) / 1000,
      rejectedByArea: rejectedArea,
      rejectedByCircularity: rejectedCircularity,
      borderFraction:
        totalSummary.count > 0
          ? Math.round((totalSummary.borderCount / totalSummary.count) * 1000) / 1000
          : 0,
    },
  };
}

// ── IF 共定位（转发 colocalize.ts，保持引擎单一入口） ──

export interface ColocEngineResult {
  overall: RoiMetrics;
  coloc: import('./colocalize.ts').ColocResult;
  overlayRgba: Uint8ClampedArray;
  warnings: string[];
}

export function analyzeColocImage(
  pixels: RgbaPixels,
  colocConfig: import('../types.ts').ColocConfig,
): ColocEngineResult {
  // 延迟 import 保持模块图简单（colocalize.ts 无副作用）
  return runColocSync(pixels, colocConfig);
}

function runColocSync(
  pixels: RgbaPixels,
  colocConfig: import('../types.ts').ColocConfig,
): ColocEngineResult {
  const colocResult = computeColocalization(pixels, colocConfig);
  const chA = channelOf(pixels, colocConfig.channelA);
  const chB = channelOf(pixels, colocConfig.channelB);
  for (let i = 0; i < chA.length; i += 1) {
    chA[i] = Math.max(0, chA[i] - colocResult.backgroundA);
    chB[i] = Math.max(0, chB[i] - colocResult.backgroundB);
  }
  const overlayRgba = buildColocOverlayRgba(chA, chB, colocResult.thresholdA, colocResult.thresholdB);
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
  return { overall: metrics, coloc: colocResult, overlayRgba, warnings: [] };
}

function channelOf(pixels: RgbaPixels, channel: 0 | 1 | 2): Float32Array {
  const out = new Float32Array(pixels.width * pixels.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = pixels.data[p + channel];
  }
  return out;
}

function fillNuclei(base: RoiMetrics, nuclei: Partial<RoiMetrics>): RoiMetrics {
  return { ...base, ...nuclei };
}
