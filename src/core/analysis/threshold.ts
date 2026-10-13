/**
 * 阈值估计：四种自动方法（Otsu / Triangle / 均值±SD / Kapur 最大熵）
 * 全部作用于 256 bin 的 OD 直方图（0–255 标尺，背景已扣除）。
 */
import type { AutoThresholdMethod } from '../types.ts';

export type Histogram = Uint32Array;

/** 将 OD 值集合量化为 256 bin 直方图（负值计入 bin 0） */
export function histogram256(values: ArrayLike<number>): Histogram {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const bin = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    hist[bin] += 1;
  }
  return hist;
}

/** 从直方图按权重取百分位（percentile ∈ [0,100]） */
export function percentileFromHist(hist: Histogram, percentile: number): number {
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

/** Otsu 1979：类间方差最大化（直方图版，含空 bin 剥离） */
export function thresholdOtsu(hist: Histogram): number {
  let start = 0;
  while (start < 256 && hist[start] === 0) start += 1;
  if (start === 256) return 0;
  let end = 255;
  while (end > start && hist[end] === 0) end -= 1;

  const n = end - start + 1;
  const counts = new Float64Array(n);
  const centers = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    counts[i] = hist[start + i];
    centers[i] = start + i;
    total += counts[i];
  }

  let weightB = 0;
  let sumB = 0;
  let maxVariance = -1;
  let threshold = start;
  let sumAll = 0;
  for (let i = 0; i < n; i += 1) sumAll += counts[i] * centers[i];

  for (let i = 0; i < n - 1; i += 1) {
    weightB += counts[i];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += counts[i] * centers[i];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = start + i;
    }
  }
  return threshold;
}

/**
 * Triangle（Prewitt & Mendez，ImageJ TriangleThreshold 同思路）：
 * 峰值点到较远端点连线上，找直方图包络的最大垂直距离点。
 */
export function thresholdTriangle(hist: Histogram): number {
  let first = 0;
  while (first < 256 && hist[first] === 0) first += 1;
  if (first === 256) return 0;
  let last = 255;
  while (last > first && hist[last] === 0) last -= 1;

  let peak = first;
  for (let i = first; i <= last; i += 1) if (hist[i] > hist[peak]) peak = i;

  // 峰值到两端距离，取较远端作为基线终点
  const distToFirst = peak - first;
  const distToLast = last - peak;
  const [a, b] = distToFirst >= distToLast ? [peak, first] : [peak, last];

  const ax = a;
  const ay = hist[a];
  const bx = b;
  const by = hist[b];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;

  let best = a;
  let bestDist = -1;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i += 1) {
    // 点 (i, hist[i]) 到直线 (ax,ay)-(bx,by) 的垂直距离
    const distance = Math.abs(dy * (i - ax) - dx * (hist[i] - ay)) / len;
    if (distance > bestDist) {
      bestDist = distance;
      best = i;
    }
  }
  return best;
}

/** 均值 + k·标准差（对像素值集合，k 固定 2，Methods 中明示） */
export function thresholdMeanSd(values: ArrayLike<number>, k = 2): number {
  const n = values.length;
  if (n === 0) return 0;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const d = values[i] - mean;
    variance += d * d;
  }
  variance /= n;
  const t = mean + k * Math.sqrt(variance);
  return Math.min(255, Math.max(0, Math.round(t)));
}

/** Kapur 1985 最大熵（ImageJ MaxEntropy 同思路） */
export function thresholdKapur(hist: Histogram): number {
  let total = 0;
  for (let i = 0; i < 256; i += 1) total += hist[i];
  if (total === 0) return 0;

  const eps = Number.EPSILON;
  const normalized = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) normalized[i] = hist[i] / total;

  const cumsum = new Float64Array(256);
  cumsum[0] = normalized[0];
  for (let i = 1; i < 256; i += 1) cumsum[i] = cumsum[i - 1] + normalized[i];

  let bestT = 0;
  let bestEntropy = -Infinity;
  for (let t = 1; t < 256; t += 1) {
    const pBg = cumsum[t - 1];
    if (pBg < eps || pBg > 1 - eps) continue;
    const pFg = 1 - pBg;
    let entBg = 0;
    for (let i = 0; i < t; i += 1) {
      if (normalized[i] > eps) {
        const p = normalized[i] / pBg;
        entBg -= p * Math.log(p);
      }
    }
    let entFg = 0;
    for (let i = t; i < 256; i += 1) {
      if (normalized[i] > eps) {
        const p = normalized[i] / pFg;
        entFg -= p * Math.log(p);
      }
    }
    const totalEntropy = entBg + entFg;
    if (totalEntropy > bestEntropy) {
      bestEntropy = totalEntropy;
      bestT = t;
    }
  }
  return bestT;
}

export function computeAutoThreshold(hist: Histogram, method: AutoThresholdMethod): number {
  switch (method) {
    case 'otsu':
      return thresholdOtsu(hist);
    case 'triangle':
      return thresholdTriangle(hist);
    case 'kapur':
      return thresholdKapur(hist);
    case 'mean_sd':
      // 均值±SD 需要原始值；直方图近似为一阶矩/二阶矩
      return thresholdMeanSdFromHist(hist);
    default: {
      const never: never = method;
      return never;
    }
  }
}

function thresholdMeanSdFromHist(hist: Histogram): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    total += hist[i];
    sum += hist[i] * i;
  }
  if (total === 0) return 0;
  const mean = sum / total;
  let variance = 0;
  for (let i = 0; i < 256; i += 1) {
    const d = i - mean;
    variance += hist[i] * d * d;
  }
  variance /= total;
  return Math.min(255, Math.max(0, Math.round(mean + 2 * Math.sqrt(variance))));
}
