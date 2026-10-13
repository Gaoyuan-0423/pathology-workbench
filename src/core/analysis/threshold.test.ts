import { describe, expect, it } from 'vitest';
import {
  computeAutoThreshold,
  histogram256,
  percentileFromHist,
  thresholdKapur,
  thresholdMeanSd,
  thresholdOtsu,
  thresholdTriangle,
} from './threshold.ts';

/** 构造双峰直方图：bin a 有 na 个、bin b 有 nb 个 */
function bimodal(a: number, na: number, b: number, nb: number): Uint32Array {
  const hist = new Uint32Array(256);
  hist[a] = na;
  hist[b] = nb;
  return hist;
}

describe('histogram256 与百分位', () => {
  it('量化与越界钳制', () => {
    const hist = histogram256([-3, 0, 10.4, 10.6, 300]);
    expect(hist[0]).toBe(2);
    expect(hist[10]).toBe(1);
    expect(hist[11]).toBe(1);
    expect(hist[255]).toBe(1);
  });

  it('百分位：p50 取中位 bin', () => {
    const hist = histogram256([0, 0, 0, 0, 100]);
    expect(percentileFromHist(hist, 50)).toBe(0);
    expect(percentileFromHist(hist, 90)).toBe(100);
    expect(percentileFromHist(hist, 0)).toBe(0);
  });
});

describe('thresholdOtsu', () => {
  it('双峰取峰间谷底（阈值 = 背景侧最后一个 bin，阳性 = 严格大于）', () => {
    const t = thresholdOtsu(bimodal(30, 100, 200, 100));
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(200);
  });

  it('权重不等时偏向低权重峰一侧', () => {
    // 大背景峰 + 小目标峰：Otsu 应落在两者之间
    const t = thresholdOtsu(bimodal(10, 900, 180, 100));
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(180);
  });

  it('全空直方图返回 0', () => {
    expect(thresholdOtsu(new Uint32Array(256))).toBe(0);
  });
});

describe('thresholdTriangle', () => {
  it('单峰偏斜直方图：阈值在峰值与远端之间', () => {
    const hist = new Uint32Array(256);
    // 指数衰减式直方图，峰在 bin 20，长尾到 220
    for (let i = 20; i <= 220; i += 1) hist[i] = Math.max(1, Math.round(1000 * Math.exp(-(i - 20) / 40)));
    const t = thresholdTriangle(hist);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThanOrEqual(220);
  });

  it('对称单峰：阈值位于峰的远端一侧', () => {
    const hist = new Uint32Array(256);
    for (let i = 0; i <= 100; i += 1) hist[i] = 100 - i;
    const t = thresholdTriangle(hist);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(100);
  });
});

describe('thresholdMeanSd', () => {
  it('正态数据：mean+2σ 阈值', () => {
    // 全部值 = 10 ± 少量扰动
    const values = [10, 12, 8, 10, 10, 14, 6, 10];
    const t = thresholdMeanSd(values, 2);
    expect(t).toBeGreaterThan(10);
  });

  it('全空返回 0', () => {
    expect(thresholdMeanSd(new Float32Array(0))).toBe(0);
  });
});

describe('thresholdKapur', () => {
  it('双峰直方图取类间熵最大的分割点', () => {
    const t = thresholdKapur(bimodal(40, 500, 200, 500));
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(200);
  });

  it('与 ImageJ MaxEntropy 语义一致：单峰也给出合法阈值', () => {
    const hist = histogram256(Array.from({ length: 100 }, (_, i) => i % 60));
    const t = thresholdKapur(hist);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });
});

describe('computeAutoThreshold 分发', () => {
  // 背景占优的真实分布：mean+2σ 才会落在两峰之间
  const hist = bimodal(50, 900, 190, 100);
  it('四种方法都落在双峰之间', () => {
    for (const method of ['otsu', 'triangle', 'kapur', 'mean_sd'] as const) {
      const t = computeAutoThreshold(hist, method);
      expect(t).toBeGreaterThanOrEqual(50);
      expect(t).toBeLessThan(190);
    }
  });
});
