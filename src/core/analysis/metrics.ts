/**
 * 区域级定量指标：在背景扣除后的 DAB 通道上按阈值计算阳性面积、IOD、平均 OD。
 * 细胞核相关字段在 M3 由 segment.ts 填充。
 */
import type { RoiMetrics } from '../types.ts';
import type { RgbaPixels } from '../image/color.ts';

export interface Rect { x: number; y: number; w: number; h: number }

/** 遍历矩形内的索引（clip 到图像边界），返回 [startRow] 迭代器风格的辅助 */
export function clipRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h)));
  return { x, y, w, h };
}

/** 整数化直方图形式的百分位（对矩形区域） */
export function regionPercentile(
  channel: Float32Array,
  width: number,
  rect: Rect,
  percentile: number,
  hist: Uint32Array,
): number {
  hist.fill(0);
  for (let row = rect.y; row < rect.y + rect.h; row += 1) {
    const base = row * width;
    for (let col = rect.x; col < rect.x + rect.w; col += 1) {
      const v = channel[base + col];
      const bin = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
      hist[bin] += 1;
    }
  }
  let total = 0;
  for (let i = 0; i < 256; i += 1) total += hist[i];
  if (total === 0) return 0;
  const target = (percentile / 100) * total;
  let cum = 0;
  for (let i = 0; i < 256; i += 1) {
    cum += hist[i];
    if (cum >= target) return i;
  }
  return 255;
}

/**
 * 在（已减背景的）通道上计算区域指标。
 * positive = value > threshold（严格大于，与阈值语义一致：阈值 bin 本身不算阳性）。
 */
export function computeAreaMetrics(
  channel: Float32Array,
  width: number,
  rect: Rect,
  threshold: number,
  extra: Partial<RoiMetrics> = {},
): RoiMetrics {
  let pixelCount = 0;
  let positiveCount = 0;
  let iod = 0;
  for (let row = rect.y; row < rect.y + rect.h; row += 1) {
    const base = row * width;
    for (let col = rect.x; col < rect.x + rect.w; col += 1) {
      const v = channel[base + col];
      pixelCount += 1;
      if (v > threshold) {
        positiveCount += 1;
        iod += v;
      }
    }
  }
  return {
    roiId: null,
    roiName: '',
    pixelCount,
    positiveFraction: pixelCount > 0 ? positiveCount / pixelCount : 0,
    positiveNuclei: 0,
    totalNuclei: 0,
    labelingIndex: null,
    borderNuclei: 0,
    integratedOpticalDensity: Math.round(iod * 10) / 10,
    meanOpticalDensity: positiveCount > 0 ? Math.round((iod / positiveCount) * 100) / 100 : null,
    estimatedTotalCount: null,
    densityPerMm2: null,
    hScore: null,
    ...extra,
  };
}

/**
 * H-score（0–300，膜/质标记临床惯用读出）：阳性核按核内平均 OD 三档计分——
 * 阳性区间 [threshold, 255] 三等分为弱/中/强，分别计 1/2/3 分，
 * 占全部计数核（含阴性）百分比的加权和。无核时 null。
 */
export function hScoreFromNuclei(meanOds: number[], threshold: number): number | null {
  const total = meanOds.length;
  if (total === 0) return null;
  const span = 255 - threshold;
  const cut1 = threshold + span / 3;
  const cut2 = threshold + (2 * span) / 3;
  let score = 0;
  for (const od of meanOds) {
    if (od <= threshold) continue;
    score += od <= cut1 ? 1 : od <= cut2 ? 2 : 3;
  }
  return (score / total) * 100;
}

/** 通道掩膜 → 紫色叠加层 RGBA（无 DOM 依赖；Worker/UI 各自包成 ImageData） */
export function buildOverlayRgba(
  dab: Float32Array,
  threshold: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dab.length * 4);
  for (let i = 0, p = 0; p < out.length; i += 1, p += 4) {
    if (dab[i] > threshold) {
      out[p] = 168; out[p + 1] = 85; out[p + 2] = 247; out[p + 3] = 110;
    }
  }
  return out;
}

/** 主入口便捷封装（测试用；Worker 内不依赖 DOM 版本见 worker.ts） */
export function positiveFractionOf(dab: Float32Array, threshold: number): number {
  let count = 0;
  for (let i = 0; i < dab.length; i += 1) if (dab[i] > threshold) count += 1;
  return dab.length > 0 ? count / dab.length : 0;
}

export type { RgbaPixels };
