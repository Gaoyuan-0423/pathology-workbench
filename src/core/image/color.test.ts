import { describe, expect, it } from 'vitest';
import {
  applyInverse,
  buildHdabMatrix,
  channelToOd,
  crossProduct,
  extractDabChannel,
  normalizeVector,
} from './color.ts';

describe('channelToOd', () => {
  it('两端点符合 0–255 标尺（端点溢出被钳制）', () => {
    expect(channelToOd(255)).toBe(0);
    expect(channelToOd(0)).toBe(255);
  });

  it('中点手算对照：od(127) = 255·ln(255/128)/ln(255) ≈ 31.72', () => {
    expect(channelToOd(127)).toBeCloseTo(31.72, 1);
  });

  it('单调且越界钳制', () => {
    expect(channelToOd(30)).toBeGreaterThan(channelToOd(60));
    expect(channelToOd(-5)).toBe(channelToOd(0));
    expect(channelToOd(300)).toBe(channelToOd(255));
  });
});

describe('buildHdabMatrix', () => {
  const { stains, inverse } = buildHdabMatrix();

  it('残差向量与 H、DAB 均正交（H 与 DAB 本不要求正交）', () => {
    const [h, d, r] = stains;
    for (const v of [h, d, r]) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 10);
    }
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(r, h)).toBeCloseTo(0, 10);
    expect(dot(r, d)).toBeCloseTo(0, 10);
  });

  it('归一化后的 H 向量与 Ruifrok 原文比例一致（0.684:0.696:0.183）', () => {
    const [h] = stains;
    expect(h[1] / h[0]).toBeCloseTo(0.696 / 0.684, 6);
    expect(h[2] / h[0]).toBeCloseTo(0.183 / 0.684, 6);
  });

  it('M·M⁻¹ = I', () => {
    const [h, d, r] = stains;
    const m = [
      [h[0], d[0], r[0]],
      [h[1], d[1], r[1]],
      [h[2], d[2], r[2]],
    ];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) sum += m[i][k] * inverse[k][j];
        expect(sum).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
  });
});

describe('deconvolution roundtrip', () => {
  it('纯 H 染色像素重建出该通道浓度、DAB≈0', () => {
    const { stains, inverse } = buildHdabMatrix();
    const concentration = 80;
    // 与 OD 标尺自洽的透射：t = 255·exp(-c·v·ln255/255) ⇒ od255(t) = c·v
    const h = stains[0];
    const transmit = (v: number) =>
      Math.max(0, Math.min(255, Math.round(255 * Math.exp((-concentration * v * Math.log(255)) / 255))));
    const r = transmit(h[0]);
    const g = transmit(h[1]);
    const b = transmit(h[2]);
    const od = [channelToOd(r), channelToOd(g), channelToOd(b)];
    const c = applyInverse(inverse, od as [number, number, number]);
    expect(Math.abs(c[0] - concentration)).toBeLessThan(1.5);
    expect(Math.abs(c[1])).toBeLessThan(0.6);
  });

  it('白色（无染色）像素 OD 全 0，两通道均为 0', () => {
    const { inverse } = buildHdabMatrix();
    const c = applyInverse(inverse, [0, 0, 0]);
    expect(c[0]).toBeCloseTo(0, 10);
    expect(c[1]).toBeCloseTo(0, 10);
  });
});

describe('extractDabChannel', () => {
  it('从合成 ImageData 提取 DAB 通道，纯 DAB 区域高于背景', () => {
    const width = 2;
    const height = 1;
    const pixels = { data: new Uint8ClampedArray(8), width, height };
    // 像素 0：白色背景
    pixels.data[0] = 255; pixels.data[1] = 255; pixels.data[2] = 255; pixels.data[3] = 255;
    // 像素 1：典型 DAB 棕色 (92, 61, 45)
    pixels.data[4] = 92; pixels.data[5] = 61; pixels.data[6] = 45; pixels.data[7] = 255;
    const dab = extractDabChannel(pixels);
    expect(dab[0]).toBeCloseTo(0, 6);
    expect(dab[1]).toBeGreaterThan(30);
  });
});

describe('vector utilities', () => {
  it('crossProduct 与 normalizeVector', () => {
    expect(crossProduct([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(normalizeVector([3, 4, 0])).toEqual([0.6, 0.8, 0]);
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
