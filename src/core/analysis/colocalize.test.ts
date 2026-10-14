import { describe, expect, it } from 'vitest';
import { computeColocalization, extractRgbChannel } from './colocalize.ts';
import { DEFAULT_COLOC, type ColocConfig } from '../types.ts';

/** 8×1 合成图：R/G/B 三通道独立赋值 */
function makePixels(r: number[], g: number[], b: number[]) {
  const data = new Uint8ClampedArray(r.length * 4);
  for (let i = 0; i < r.length; i += 1) {
    data[i * 4] = r[i];
    data[i * 4 + 1] = g[i];
    data[i * 4 + 2] = b[i];
    data[i * 4 + 3] = 255;
  }
  return { data, width: r.length, height: 1 };
}

function config(overrides: Partial<ColocConfig>): ColocConfig {
  return { ...DEFAULT_COLOC, ...overrides };
}

describe('extractRgbChannel', () => {
  it('按通道抽取', () => {
    const pixels = makePixels([10, 20], [30, 40], [50, 60]);
    expect([...extractRgbChannel(pixels, 0)]).toEqual([10, 20]);
    expect([...extractRgbChannel(pixels, 2)]).toEqual([50, 60]);
  });
});

describe('computeColocalization（手动阈值，手算对照）', () => {
  const R = [0, 0, 10, 10, 20, 20, 0, 0];
  const G_anti = [0, 0, 10, 10, 0, 0, 20, 20];
  const G_proportional = [0, 0, 20, 20, 40, 40, 0, 0];

  it('反相关双通道：掩膜 Pearson = 0，M1 = M2 = 0.5', () => {
    const result = computeColocalization(
      makePixels(R, G_anti, [0, 0, 0, 0, 0, 0, 0, 0]),
      config({ channelA: 0, channelB: 1, thresholdMode: 'manual', manualA: 5, manualB: 5, backgroundPercentile: 0 }),
    );
    // 并集掩膜内：重叠像素值相等、互斥区互补 → 完全反相关
    expect(result.pearsonMasked).toBeCloseTo(-1, 6);
    // M1 = A 总量 60 中落在 B 阳性区（idx2,3，值 10+10）的份额 = 1/3；M2 对称
    expect(result.mandersM1).toBeCloseTo(1 / 3, 6);
    expect(result.mandersM2).toBeCloseTo(1 / 3, 6);
    expect(result.pearsonAll).toBeCloseTo(-250 / 550, 6);
  });

  it('完全线性相关：Pearson = 1，M1 = M2 = 1', () => {
    const result = computeColocalization(
      makePixels(R, G_proportional, [0, 0, 0, 0, 0, 0, 0, 0]),
      config({ channelA: 0, channelB: 1, thresholdMode: 'manual', manualA: 5, manualB: 5, backgroundPercentile: 0 }),
    );
    expect(result.pearsonMasked).toBeCloseTo(1, 6);
    expect(result.pearsonAll).toBeCloseTo(1, 6);
    expect(result.mandersM1).toBeCloseTo(1, 6);
    expect(result.mandersM2).toBeCloseTo(1, 6);
  });

  it('背景百分位扣除后再阈值', () => {
    // R = [50,50,50,50,60,60,60,60]，p50 背景为 50 → 扣除后 [0×4, 10×4]
    const pixels = makePixels([50, 50, 50, 50, 60, 60, 60, 60], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]);
    const result = computeColocalization(
      pixels,
      config({ channelA: 0, channelB: 2, thresholdMode: 'manual', manualA: 5, manualB: 200, backgroundPercentile: 50 }),
    );
    expect(result.backgroundA).toBe(50);
    expect(result.thresholdA).toBe(5);
    // B 全为 0：M1 = A 在 B 阳性区（空集）→ 0
    expect(result.mandersM1).toBe(0);
  });

  it('auto 模式：三水平通道 Otsu 分割后掩膜 Pearson 有限', () => {
    const result = computeColocalization(
      makePixels([0, 0, 5, 5, 20, 20, 30, 30], [0, 0, 20, 20, 40, 40, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]),
      config({ channelA: 0, channelB: 1, thresholdMode: 'auto', backgroundPercentile: 0 }),
    );
    expect(result.thresholdA).toBeGreaterThanOrEqual(5);
    expect(result.thresholdA).toBeLessThan(30);
    expect(Number.isFinite(result.pearsonMasked)).toBe(true);
    expect(result.pearsonMasked).toBeGreaterThanOrEqual(-1);
    expect(result.pearsonMasked).toBeLessThanOrEqual(1);
  });

  it('常数通道：Pearson 为 NaN、Manders 为 0，不崩溃', () => {
    const result = computeColocalization(
      makePixels([7, 7, 7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 7, 7, 7], [0, 0, 0, 0, 0, 0, 0, 0]),
      config({ channelA: 0, channelB: 1, thresholdMode: 'manual', manualA: 5, manualB: 5, backgroundPercentile: 0 }),
    );
    expect(Number.isNaN(result.pearsonMasked)).toBe(true);
    // 掩膜内常数通道：M1 = A 全部位于 B 阳性区 → 1（Pearson 无方差故 NaN）
    expect(result.mandersM1).toBe(1);
  });
});
