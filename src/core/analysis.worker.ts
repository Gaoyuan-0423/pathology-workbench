/**
 * 分析 Worker：解码后的像元级计算全部在此线程执行（去卷积/阈值/指标）。
 * 通过 requestId 丢弃过期结果；UI 持有最新请求即可。
 */
import { extractDabChannel } from './image/color.ts';
import { buildOverlay, clipRect, computeAreaMetrics } from './analysis/metrics.ts';
import { computeAutoThreshold, histogram256, percentileFromHist } from './analysis/threshold.ts';
import type {
  AnalysisResult,
  Roi,
  SegmentationConfig,
  ThresholdConfig,
} from './types.ts';

export interface AnalysisRequest {
  requestId: number;
  pixels: ImageData;
  rois: Roi[];
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
}

const workerSelf = self as unknown as WorkerScope & {
  postMessage: (message: AnalysisResult) => void;
};

workerSelf.onmessage = (event) => {
  const { requestId, pixels, rois, threshold } = event.data;
  const warnings: string[] = [];
  const { width, height } = pixels;

  // 1. Ruifrok 去卷积 → DAB 光密度通道
  const dab = extractDabChannel(pixels);

  // 2. 背景水平（全图 OD 百分位）并扣除
  const fullHist = histogram256(dab);
  const backgroundLevel = percentileFromHist(fullHist, threshold.backgroundPercentile);
  for (let i = 0; i < dab.length; i += 1) {
    const v = dab[i] - backgroundLevel;
    dab[i] = v > 0 ? v : 0;
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
    const subtractedHist = histogram256(dab);
    thresholdUsed = computeAutoThreshold(subtractedHist, 'otsu');
    if (threshold.mode === 'auto') {
      thresholdUsed = computeAutoThreshold(subtractedHist, threshold.method);
    }
  }

  // 4. 整图 + 各 ROI 指标
  const fullRect = clipRect({ x: 0, y: 0, w: width, h: height }, width, height);
  const overall = computeAreaMetrics(dab, width, fullRect, thresholdUsed, {
    roiId: null,
    roiName: '整图',
  });
  const perRoi = rois.map((roi) => {
    const rect = clipRect(roi, width, height);
    return computeAreaMetrics(dab, width, rect, thresholdUsed, {
      roiId: roi.id,
      roiName: roi.name,
    });
  });

  // 5. 叠加层（M3 将加入细胞核标记）
  const overlay = buildOverlay(dab, width, height, thresholdUsed);

  const result: AnalysisResult = {
    requestId,
    overall,
    perRoi,
    thresholdUsed,
    backgroundLevel,
    overlay,
    warnings,
  };
  workerSelf.postMessage(result);
};
