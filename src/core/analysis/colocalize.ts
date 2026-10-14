/**
 * 双通道荧光共定位：背景扣除 + 逐通道阈值 + 掩膜 Pearson + Manders M1/M2。
 *
 * 设计要点（对照竞品与文献的已知陷阱）：
 * - Pearson 同时给出全像素版与掩膜版——全像素版受暗背景偏置影响（经典坑），
 *   掩膜版（任一通道超阈的像素集合）作为主指标；
 * - Manders M1/M2 在背景扣除后的强度上计算，M1 = B 通道超阈像素内 A 强度占比。
 */
import { histogram256, percentileFromHist, thresholdOtsu } from './threshold.ts';
import type { ColocConfig } from '../types.ts';

export interface ColocResult {
  channelA: number;
  channelB: number;
  /** 全像素 Pearson r（参考值，受背景偏置影响） */
  pearsonAll: number;
  /** 掩膜 Pearson r（任一通道超阈的像素）——主指标 */
  pearsonMasked: number;
  /** M1 = A 在 B 阳性区域的强度占比 */
  mandersM1: number;
  /** M2 = B 在 A 阳性区域的强度占比 */
  mandersM2: number;
  thresholdA: number;
  thresholdB: number;
  backgroundA: number;
  backgroundB: number;
}

/** 提取 RGB 图像的单通道强度（0–255） */
export function extractRgbChannel(pixels: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, channel: 0 | 1 | 2): Float32Array {
  const { data, width, height } = pixels;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = data[p + channel];
  }
  return out;
}

function pearson(xs: Float32Array, ys: Float32Array, mask?: Uint8Array): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
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
  }
  if (n < 2) return NaN;
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const denom = Math.sqrt(vx * vy);
  return denom === 0 ? NaN : cov / denom;
}

export function computeColocalization(
  pixels: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  config: ColocConfig,
): ColocResult {
  const rawA = extractRgbChannel(pixels, config.channelA);
  const rawB = extractRgbChannel(pixels, config.channelB);

  // 逐通道背景扣除
  const bgA = percentileFromHist(histogram256(rawA), config.backgroundPercentile);
  const bgB = percentileFromHist(histogram256(rawB), config.backgroundPercentile);
  const chA = new Float32Array(rawA.length);
  const chB = new Float32Array(rawB.length);
  for (let i = 0; i < rawA.length; i += 1) {
    chA[i] = Math.max(0, rawA[i] - bgA);
    chB[i] = Math.max(0, rawB[i] - bgB);
  }

  const thresholdA =
    config.thresholdMode === 'manual'
      ? Math.min(255, Math.max(0, Math.round(config.manualA)))
      : thresholdOtsu(histogram256(chA));
  const thresholdB =
    config.thresholdMode === 'manual'
      ? Math.min(255, Math.max(0, Math.round(config.manualB)))
      : thresholdOtsu(histogram256(chB));

  const maskA = new Uint8Array(chA.length);
  const maskB = new Uint8Array(chA.length);
  const maskUnion = new Uint8Array(chA.length);
  let sumA = 0;
  let sumAinB = 0;
  let sumB = 0;
  let sumBinA = 0;
  for (let i = 0; i < chA.length; i += 1) {
    const aPositive = chA[i] > thresholdA;
    const bPositive = chB[i] > thresholdB;
    maskA[i] = aPositive ? 1 : 0;
    maskB[i] = bPositive ? 1 : 0;
    maskUnion[i] = aPositive || bPositive ? 1 : 0;
    sumA += chA[i];
    sumB += chB[i];
    if (bPositive) sumAinB += chA[i];
    if (aPositive) sumBinA += chB[i];
  }

  return {
    channelA: config.channelA,
    channelB: config.channelB,
    pearsonAll: pearson(chA, chB),
    pearsonMasked: pearson(chA, chB, maskUnion),
    mandersM1: sumA > 0 ? sumAinB / sumA : 0,
    mandersM2: sumB > 0 ? sumBinA / sumB : 0,
    thresholdA,
    thresholdB,
    backgroundA: bgA,
    backgroundB: bgB,
  };
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
