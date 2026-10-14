import { describe, expect, it } from 'vitest';
import { inferPlaneSize, probToMask, resizeGray, toModelTensor } from './prepost.ts';

describe('resizeGray', () => {
  it('同尺寸原样返回（副本）', () => {
    const src = new Float32Array([1, 2, 3, 4]);
    const out = resizeGray(src, 2, 2, 2, 2);
    expect([...out]).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(src);
  });

  it('放大 2×：中心值保持', () => {
    const src = new Float32Array([0, 0, 0, 100]);
    const out = resizeGray(src, 2, 2, 4, 4);
    expect(out.length).toBe(16);
    // 右下角接近 100
    expect(out[4 * 4 - 1]).toBeCloseTo(100, 0);
    expect(out[0]).toBeCloseTo(0, 0);
  });

  it('缩小：均值平滑', () => {
    const src = new Float32Array([0, 100, 0, 100]);
    const out = resizeGray(src, 2, 2, 1, 1);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(100);
  });
});

describe('toModelTensor', () => {
  it('单通道：NCHW 归一化', () => {
    const gray = new Float32Array([0, 128, 255, 64]);
    const tensor = toModelTensor(gray, 2, 2, 1);
    expect(tensor.length).toBe(4);
    expect(tensor[0]).toBeCloseTo(0, 6);
    expect(tensor[1]).toBeCloseTo(128 / 255, 6);
    expect(tensor[2]).toBeCloseTo(1, 6);
  });

  it('三通道：复制三份', () => {
    const gray = new Float32Array([255, 0]);
    const tensor = toModelTensor(gray, 2, 1, 3);
    expect(tensor.length).toBe(6);
    expect(tensor[0]).toBeCloseTo(1, 6);
    expect(tensor[2]).toBeCloseTo(1, 6);
    expect(tensor[4]).toBeCloseTo(1, 6);
  });
});

describe('probToMask', () => {
  it('概率输入：按 0.5 阈值', () => {
    const mask = probToMask(new Float32Array([0.2, 0.5, 0.8, 1.0]), 0.5);
    expect([...mask]).toEqual([0, 0, 1, 1]); // 0.5 严格大于不算
  });

  it('logits 输入：自动 sigmoid', () => {
    // sigmoid(0)=0.5、sigmoid(4)≈0.982
    const mask = probToMask(new Float32Array([-2, 0, 4]), 0.5);
    expect([...mask]).toEqual([0, 0, 1]);
  });

  it('自定义阈值', () => {
    const mask = probToMask(new Float32Array([0.3, 0.6]), 0.8);
    expect([...mask]).toEqual([0, 0]);
  });
});

describe('inferPlaneSize', () => {
  it('与输入同尺寸优先', () => {
    expect(inferPlaneSize(4096, 64, 64)).toEqual({ width: 64, height: 64 });
  });
  it('展平输出按输入宽回推', () => {
    expect(inferPlaneSize(12, 4, 3)).toEqual({ width: 4, height: 3 });
  });
  it('未知尺寸取近似平方因子', () => {
    const { width, height } = inferPlaneSize(100, 7, 7);
    expect(width * height).toBe(100);
  });
});
