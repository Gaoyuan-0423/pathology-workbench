/**
 * 分析 Worker：解码后的像元级计算全部在此线程执行
 * （去卷积 → 背景扣除 → 阈值 → 苏木精核分割 → 门控计数 → 指标）。
 * 通过 requestId 丢弃过期结果；UI 持有最新请求即可。
 */
import { extractDabChannel, extractHematoxylinChannel } from './image/color.ts';
import { buildOverlay, clipRect, computeAreaMetrics } from './analysis/metrics.ts';
import { computeAutoThreshold, histogram256, percentileFromHist } from './analysis/threshold.ts';
import {
  connectedComponents,
  gateComponents,
  meanChannelOverComponent,
  summarizeComponents,
} from './analysis/segment.ts';
import type {
  AnalysisResult,
  Calibration,
  Roi,
  RoiMetrics,
  SegmentationConfig,
  ThresholdConfig,
} from './types.ts';

export interface AnalysisRequest {
  requestId: number;
  pixels: ImageData;
  rois: Roi[];
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  calibration: Calibration;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
}

const workerSelf = self as unknown as WorkerScope & {
  postMessage: (message: AnalysisResult) => void;
};

/** 核面积门控按工作图缩放比例换算时使用原始像素面积（配置即工作图像素） */
function estimateTotal(count: number, borderCount: number): number {
  if (count <= 0) return 0;
  const value = count + (borderCount * count) / (count + borderCount);
  return Math.round(value * 10) / 10;
}

workerSelf.onmessage = (event) => {
  const { requestId, pixels, rois, threshold, segmentation } = event.data;
  const warnings: string[] = [];
  const { width, height } = pixels;

  // 1. Ruifrok 去卷积 → DAB / 苏木精双通道
  const dab = extractDabChannel(pixels);
  const hematoxylin = extractHematoxylinChannel(pixels);

  // 2. DAB 背景水平（全图 OD 百分位）并扣除
  const fullHist = histogram256(dab);
  const backgroundLevel = percentileFromHist(fullHist, threshold.backgroundPercentile);
  for (let i = 0; i < dab.length; i += 1) {
    const v = dab[i] - backgroundLevel;
    dab[i] = v > 0 ? v : 0;
  }

  // 3. DAB 阈值解析
  let thresholdUsed: number;
  if (threshold.mode === 'manual') {
    thresholdUsed = Math.min(255, Math.max(0, Math.round(threshold.manualValue)));
  } else if (threshold.mode === 'control' && threshold.controlThreshold !== null) {
    thresholdUsed = threshold.controlThreshold;
  } else {
    if (threshold.mode === 'control') {
      warnings.push('对照片尚未标定，本次使用 Otsu 自动阈值。');
    }
    const subtractedHist = histogram256(dab);
    thresholdUsed = computeAutoThreshold(subtractedHist, threshold.method);
  }

  // 4. 苏木精核分割（逐图 Otsu；不扣背景——核复染在组织内普遍存在）
  const hHist = histogram256(hematoxylin);
  const nuclearThresholdUsed = computeAutoThreshold(hHist, 'otsu');
  const nuclearMask = new Uint8Array(dab.length);
  for (let i = 0; i < hematoxylin.length; i += 1) {
    nuclearMask[i] = hematoxylin[i] > nuclearThresholdUsed ? 1 : 0;
  }
  const allComponents = connectedComponents(nuclearMask, width, height);
  const { kept: nuclei, rejectedArea, rejectedCircularity } = gateComponents(allComponents, segmentation);

  // 5. 每个核的阳性判定：核内平均 DAB OD > 阈值
  interface Nucleus {
    cx: number;
    cy: number;
    positive: boolean;
    touchesBorder: boolean;
  }
  const nucleusList: Nucleus[] = nuclei.map((component) => {
    let seed = Math.round(component.cy) * width + Math.round(component.cx);
    if (nuclearMask[seed] === 0) {
      // 环形等非凸目标：在质心附近找掩膜内种子
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
    const meanDab = nuclearMask[seed] === 1 ? meanChannelOverComponent(dab, width, nuclearMask, seed) : 0;
    return {
      cx: component.cx,
      cy: component.cy,
      positive: meanDab > thresholdUsed,
      touchesBorder: component.touchesBorder,
    };
  });

  const totalSummary = summarizeComponents(nuclei);
  const positiveCount = nucleusList.reduce((sum, item) => sum + (item.positive ? 1 : 0), 0);
  const positiveBorder = nucleusList.reduce(
    (sum, item) => sum + (item.positive && item.touchesBorder ? 1 : 0),
    0,
  );
  const mpp = event.data.calibration?.mpp ?? null;
  const areaMm2Safe = mpp !== null ? (width * height * mpp * mpp) / 1e6 : null;
  if (rejectedArea + rejectedCircularity > 0 && nuclei.length === 0) {
    warnings.push('门控参数滤除了全部分割目标，请调整面积/圆度范围。');
  }

  // 6. 整图与各 ROI 指标
  const fullRect = clipRect({ x: 0, y: 0, w: width, h: height }, width, height);
  const overall = fillNuclei(
    computeAreaMetrics(dab, width, fullRect, thresholdUsed, {
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
    const roiBorder = inside.reduce((sum, item) => sum + (item.touchesBorder ? 1 : 0), 0);
    const roiEstimated = estimateTotal(roiTotal, roiBorder);
    const roiAreaMm2 =
      mpp !== null ? (rect.w * rect.h * event.data.calibration!.mpp! ** 2) / 1e6 : null;
    return fillNuclei(
      computeAreaMetrics(dab, width, rect, thresholdUsed, {
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

  // 7. 叠加层（阳性面积填充）
  const overlay = buildOverlay(dab, width, height, thresholdUsed);

  const result: AnalysisResult = {
    requestId,
    overall,
    perRoi,
    thresholdUsed,
    nuclearThresholdUsed,
    backgroundLevel,
    overlay,
    warnings,
  };
  workerSelf.postMessage(result);
};

function fillNuclei(base: RoiMetrics, nuclei: Partial<RoiMetrics>): RoiMetrics {
  return { ...base, ...nuclei };
}
