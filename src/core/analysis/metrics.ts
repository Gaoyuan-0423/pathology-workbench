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
    integratedOpticalDensity: Math.round(iod * 10) / 10,
    meanOpticalDensity: positiveCount > 0 ? Math.round((iod / positiveCount) * 100) / 100 : null,
    estimatedTotalCount: null,
    densityPerMm2: null,
    ...extra,
  };
}

/** DAB 通道 + 掩膜 → 紫色叠加层（主线程直接合成到画布） */
export function buildOverlay(
  dab: Float32Array,
  width: number,
  height: number,
  threshold: number,
): ImageData {
  const out = new ImageData(width, height);
  const data = out.data;
  for (let i = 0, p = 0; p < data.length; i += 1, p += 4) {
    if (dab[i] > threshold) {
      data[p] = 168; data[p + 1] = 85; data[p + 2] = 247; data[p + 3] = 110;
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
