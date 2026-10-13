import { describe, expect, it } from 'vitest';
import { clipRect, computeAreaMetrics, positiveFractionOf, regionPercentile } from './metrics.ts';

function flatChannel(width: number, height: number, fill: (index: number) => number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = fill(i);
  return out;
}

describe('clipRect', () => {
  it('越界矩形裁剪回图像内', () => {
    expect(clipRect({ x: -5, y: -5, w: 999, h: 999 }, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(clipRect({ x: 8, y: 8, w: 4, h: 4 }, 10, 10)).toEqual({ x: 8, y: 8, w: 2, h: 2 });
  });
});

describe('regionPercentile', () => {
  it('小区域百分位（下秩约定：累积计数达到目标即返回当前 bin）', () => {
    const channel = flatChannel(4, 1, (i) => i * 10); // 0,10,20,30
    const hist = new Uint32Array(256);
    expect(regionPercentile(channel, 4, { x: 0, y: 0, w: 4, h: 1 }, 50, hist)).toBe(10);
    expect(regionPercentile(channel, 4, { x: 0, y: 0, w: 4, h: 1 }, 90, hist)).toBe(30);
    expect(regionPercentile(channel, 4, { x: 0, y: 0, w: 4, h: 1 }, 10, hist)).toBe(0);
  });
});

describe('computeAreaMetrics', () => {
  it('已知占比的通道：阳性分数、IOD、平均 OD', () => {
    const width = 10;
    const height = 10;
    // 30 个像素 = 60，70 个像素 = 5（阈值 50：阳性 30%）
    const channel = flatChannel(width, height, (i) => (i < 30 ? 60 : 5));
    const m = computeAreaMetrics(channel, width, { x: 0, y: 0, w: width, h: height }, 50);
    expect(m.pixelCount).toBe(100);
    expect(m.positiveFraction).toBeCloseTo(0.3, 10);
    expect(m.integratedOpticalDensity).toBeCloseTo(60 * 30, 1);
    expect(m.meanOpticalDensity).toBeCloseTo(60, 1);
  });

  it('严格大于语义：等于阈值不算阳性', () => {
    const channel = flatChannel(2, 1, () => 40);
    const m = computeAreaMetrics(channel, 2, { x: 0, y: 0, w: 2, h: 1 }, 40);
    expect(m.positiveFraction).toBe(0);
  });

  it('ROI 子区域只统计矩形内', () => {
    const width = 10;
    const channel = flatChannel(width, 10, (i) => (i % width < 5 ? 100 : 0));
    const m = computeAreaMetrics(channel, width, { x: 5, y: 0, w: 5, h: 10 }, 50);
    expect(m.pixelCount).toBe(50);
    expect(m.positiveFraction).toBe(0);
  });
});

describe('positiveFractionOf', () => {
  it('空通道返回 0', () => {
    expect(positiveFractionOf(new Float32Array(0), 10)).toBe(0);
  });
});
