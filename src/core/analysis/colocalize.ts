/**
 * 双通道荧光共定位：背景扣除 + 逐通道阈值 + 掩膜 Pearson + Manders M1/M2。
 *
 * 设计要点（对照竞品与文献的已知陷阱）：
 * - Pearson 同时给出全像素版与掩膜版——全像素版受暗背景偏置影响（经典坑），
 *   同时保留掩膜版（任一通道超阈的像素集合），明确两种区域口径；
 * - Manders M1/M2 在背景扣除后的强度上计算，M1 = B 通道超阈像素内 A 强度占比。
 */
import { histogram256, percentileFromHist, thresholdOtsu } from './threshold.ts';
import type { ColocConfig, ColocResult, IfAnalysisResult, IfRegionResult, IfUndefinedReason, Roi } from '../types.ts';
export type { ColocResult } from '../types.ts';

type ColocPixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** 提取 RGB 图像的单通道强度（0–255） */
export function extractRgbChannel(pixels: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, channel: 0 | 1 | 2): Float32Array {
  const { data, width, height } = pixels;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = data[p + channel];
  }
  return out;
}

interface PearsonMeasurement {
  value: number;
  count: number;
  hasVariance: boolean;
}

/** Preserve the legacy summation order and formula for finite whole-image values. */
function pearson(xs: Float32Array, ys: Float32Array, mask?: Uint8Array): PearsonMeasurement {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    if (mask && mask[i] === 0) continue;
    const x = xs[i];
    const y = ys[i];
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (n < 2) return { value: NaN, count: n, hasVariance: false };
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const denom = Math.sqrt(vx * vy);
  return { value: denom === 0 ? NaN : cov / denom, count: n,
    hasVariance: maxX > minX && maxY > minY && vx > 0 && vy > 0 };
}

interface PreparedChannels {
  width: number;
  height: number;
  config: ColocConfig;
  chA: Float32Array;
  chB: Float32Array;
  thresholdA: number;
  thresholdB: number;
  backgroundA: number;
  backgroundB: number;
}

function prepareChannels(pixels: ColocPixels, config: ColocConfig): PreparedChannels {
  if (!Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width <= 0 || pixels.height <= 0 ||
      pixels.data.length !== pixels.width * pixels.height * 4) {
    throw new Error('IF 图像尺寸与 RGBA 数据长度不一致。');
  }
  if (![0, 1, 2].includes(config.channelA) || ![0, 1, 2].includes(config.channelB) ||
      !['auto', 'manual'].includes(config.thresholdMode) || !Number.isFinite(config.backgroundPercentile) ||
      config.backgroundPercentile < 0 || config.backgroundPercentile > 100 ||
      (config.thresholdMode === 'manual' && (!Number.isFinite(config.manualA) || !Number.isFinite(config.manualB)))) {
    throw new Error('IF 通道、背景或阈值配置无效。');
  }
  const rawA = extractRgbChannel(pixels, config.channelA);
  const rawB = extractRgbChannel(pixels, config.channelB);
  const backgroundA = percentileFromHist(histogram256(rawA), config.backgroundPercentile);
  const backgroundB = percentileFromHist(histogram256(rawB), config.backgroundPercentile);
  const chA = new Float32Array(rawA.length);
  const chB = new Float32Array(rawB.length);
  for (let i = 0; i < rawA.length; i += 1) {
    chA[i] = Math.max(0, rawA[i] - backgroundA);
    chB[i] = Math.max(0, rawB[i] - backgroundB);
  }
  const thresholdA = config.thresholdMode === 'manual'
    ? Math.min(255, Math.max(0, Math.round(config.manualA))) : thresholdOtsu(histogram256(chA));
  const thresholdB = config.thresholdMode === 'manual'
    ? Math.min(255, Math.max(0, Math.round(config.manualB))) : thresholdOtsu(histogram256(chB));
  return { width: pixels.width, height: pixels.height, config, chA, chB, thresholdA, thresholdB, backgroundA, backgroundB };
}

/** Round each component as in stain analysis, then use the true half-open intersection. */
export function clippedIfRoi(roi: Roi, width: number, height: number): IfRegionResult['rect'] {
  if (![roi.x, roi.y, roi.w, roi.h].every(Number.isFinite) || roi.w <= 0 || roi.h <= 0) {
    throw new Error('IF ROI 坐标必须有限，原始宽度和高度必须大于零。');
  }
  const rawX = Math.round(roi.x);
  const rawY = Math.round(roi.y);
  const rawW = Math.round(roi.w);
  const rawH = Math.round(roi.h);
  if (![rawX, rawY, rawW, rawH, rawX + rawW, rawY + rawH].every(Number.isSafeInteger)) {
    throw new Error('IF ROI 坐标超出可安全表示的整数范围。');
  }
  const x = Math.min(width, Math.max(0, rawX));
  const y = Math.min(height, Math.max(0, rawY));
  const right = Math.min(width, Math.max(0, rawX + rawW));
  const bottom = Math.min(height, Math.max(0, rawY + rawH));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function regionChannels(prepared: PreparedChannels, rect: IfRegionResult['rect']): [Float32Array, Float32Array] {
  if (rect.x === 0 && rect.y === 0 && rect.w === prepared.width && rect.h === prepared.height) return [prepared.chA, prepared.chB];
  const a = new Float32Array(rect.w * rect.h);
  const b = new Float32Array(rect.w * rect.h);
  let index = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
    const source = y * prepared.width + x;
    a[index] = prepared.chA[source]; b[index] = prepared.chB[source]; index += 1;
  }
  return [a, b];
}

function measureRegion(prepared: PreparedChannels, rect: IfRegionResult['rect'], roiId: string | null, roiName: string): {
  region: IfRegionResult;
  legacy: ColocResult;
} {
  const [chA, chB] = regionChannels(prepared, rect);
  const maskUnion = new Uint8Array(chA.length);
  let sumA = 0; let sumB = 0; let sumAInBPositive = 0; let sumBInAPositive = 0;
  let positivePixelsA = 0; let positivePixelsB = 0; let unionPixels = 0; let intersectionPixels = 0;
  for (let i = 0; i < chA.length; i += 1) {
    const aPositive = chA[i] > prepared.thresholdA;
    const bPositive = chB[i] > prepared.thresholdB;
    if (aPositive) positivePixelsA += 1;
    if (bPositive) positivePixelsB += 1;
    if (aPositive || bPositive) { maskUnion[i] = 1; unionPixels += 1; }
    if (aPositive && bPositive) intersectionPixels += 1;
    sumA += chA[i]; sumB += chB[i];
    if (bPositive) sumAInBPositive += chA[i];
    if (aPositive) sumBInAPositive += chB[i];
  }
  const all = pearson(chA, chB);
  const masked = pearson(chA, chB, maskUnion);
  const undefinedReasons: IfUndefinedReason[] = [];
  const validPearson = (value: PearsonMeasurement, scope: 'all' | 'masked'): number | null => {
    if (value.count < 2) {
      undefinedReasons.push(scope === 'all' ? 'pearson_all_insufficient_pixels' : 'pearson_masked_insufficient_pixels');
      return null;
    }
    if (!value.hasVariance || !Number.isFinite(value.value)) {
      undefinedReasons.push(scope === 'all' ? 'pearson_all_zero_variance' : 'pearson_masked_zero_variance');
      return null;
    }
    return value.value;
  };
  const pearsonAll = validPearson(all, 'all');
  const pearsonMasked = validPearson(masked, 'masked');
  if (sumA === 0) undefinedReasons.push('manders_m1_zero_denominator');
  if (sumB === 0) undefinedReasons.push('manders_m2_zero_denominator');
  const legacy: ColocResult = {
    channelA: prepared.config.channelA, channelB: prepared.config.channelB,
    pearsonAll: all.value, pearsonMasked: masked.value,
    mandersM1: sumA > 0 ? sumAInBPositive / sumA : 0,
    mandersM2: sumB > 0 ? sumBInAPositive / sumB : 0,
    thresholdA: prepared.thresholdA, thresholdB: prepared.thresholdB,
    backgroundA: prepared.backgroundA, backgroundB: prepared.backgroundB,
  };
  return { legacy, region: {
    roiId, roiName, rect, pixelCount: chA.length,
    positivePixelsA, positivePixelsB, unionPixels, intersectionPixels,
    channelA: prepared.config.channelA, channelB: prepared.config.channelB,
    thresholdA: prepared.thresholdA, thresholdB: prepared.thresholdB,
    backgroundA: prepared.backgroundA, backgroundB: prepared.backgroundB,
    pearsonAll, pearsonMasked,
    mandersM1: sumA > 0 ? sumAInBPositive / sumA : null,
    mandersM2: sumB > 0 ? sumBInAPositive / sumB : null,
    sumA, sumB, sumAInBPositive, sumBInAPositive, undefinedReasons,
  } };
}

/** Whole-image preprocessing is performed once and held fixed for all requested ROIs. */
export function computeColocalizationRegions(pixels: ColocPixels, config: ColocConfig, rois: Roi[] = []): {
  coloc: ColocResult;
  ifAnalysis: IfAnalysisResult;
  chA: Float32Array;
  chB: Float32Array;
} {
  const ids = new Set<string>();
  const rectangles = rois.map((roi) => {
    if (!roi || typeof roi.id !== 'string' || !roi.id.trim() || ids.has(roi.id)) throw new Error('IF ROI ID 必须非空且唯一。');
    ids.add(roi.id);
    return clippedIfRoi(roi, pixels.width, pixels.height);
  });
  const prepared = prepareChannels(pixels, config);
  const overall = measureRegion(prepared, { x: 0, y: 0, w: pixels.width, h: pixels.height }, null, '整图');
  const perRoi = rois.map((roi, index) => measureRegion(prepared, rectangles[index], roi.id, roi.name).region);
  return { coloc: overall.legacy,
    ifAnalysis: { schemaVersion: 'wisplab.if-colocalization/v1', normalizationScope: 'whole_image',
      imageWidth: pixels.width, imageHeight: pixels.height, overall: overall.region, perRoi },
    chA: prepared.chA, chB: prepared.chB };
}

/** Legacy whole-image interface retained with the original NaN/zero conventions. */
export function computeColocalization(pixels: ColocPixels, config: ColocConfig): ColocResult {
  return computeColocalizationRegions(pixels, config).coloc;
}

/** 共定位叠加层：A 通道品红、B 通道绿、重叠区偏白（无 DOM 依赖，Worker 可用） */
export function buildColocOverlayRgba(
  chA: Float32Array,
  chB: Float32Array,
  thresholdA: number,
  thresholdB: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(chA.length * 4);
  for (let i = 0, p = 0; p < out.length; i += 1, p += 4) {
    const a = chA[i] > thresholdA;
    const b = chB[i] > thresholdB;
    if (a && b) {
      out[p] = 235; out[p + 1] = 230; out[p + 2] = 255; out[p + 3] = 150;
    } else if (a) {
      out[p] = 236; out[p + 1] = 72; out[p + 2] = 153; out[p + 3] = 120;
    } else if (b) {
      out[p] = 74; out[p + 1] = 222; out[p + 2] = 128; out[p + 3] = 120;
    }
  }
  return out;
}
