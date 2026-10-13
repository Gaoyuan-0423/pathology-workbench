import { describe, expect, it } from 'vitest';
import { compareGroups } from './statistics.ts';
import type { ValueGroup } from '../types.ts';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(n: number, seed: number, shift = 0): number[] {
  const next = mulberry32(seed);
  return Array.from({ length: n }, () => {
    let sum = 0;
    for (let k = 0; k < 12; k += 1) sum += next();
    return sum - 6 + shift;
  });
}

const twoNormal: ValueGroup[] = [
  { name: '对照', values: normalSample(12, 11) },
  { name: '处理', values: normalSample(12, 12, 1.5) },
];

describe('compareGroups', () => {
  it('两组：给出 Welch t 与 Mann-Whitney 双路径且显著性一致', () => {
    const report = compareGroups(twoNormal);
    expect(report.omnibusParametric?.label).toContain('Welch');
    expect(report.omnibusNonParametric?.label).toContain('Mann-Whitney');
    expect(report.omnibusParametric!.p).toBeLessThan(0.05);
    expect(report.omnibusNonParametric!.p).toBeLessThan(0.05);
    expect(report.pairwise).toHaveLength(0);
    expect(report.leveneP).not.toBeNull();
    expect(report.recommendation).toContain('参数');
  });

  it('两组无差异：p 均不显著', () => {
    const report = compareGroups([
      { name: 'A', values: normalSample(12, 21) },
      { name: 'B', values: normalSample(12, 22) },
    ]);
    expect(report.omnibusParametric!.p).toBeGreaterThan(0.05);
    expect(report.omnibusNonParametric!.p).toBeGreaterThan(0.05);
  });

  it('三组显著差异：ANOVA + Kruskal-Wallis + Dunnett/Holm 两两比较', () => {
    const report = compareGroups([
      { name: '对照', values: normalSample(10, 31) },
      { name: '低剂量', values: normalSample(10, 32, 1.2) },
      { name: '高剂量', values: normalSample(10, 33, 2.6) },
    ]);
    expect(report.omnibusParametric!.p).toBeLessThan(0.01);
    expect(report.omnibusNonParametric!.p).toBeLessThan(0.01);
    const dunnett = report.pairwise.filter((row) => row.method === 'dunnett');
    const holmMw = report.pairwise.filter((row) => row.method === 'holm-mw');
    expect(dunnett).toHaveLength(2);
    expect(holmMw).toHaveLength(3);
    // 高剂量 vs 对照最显著
    const high = dunnett.find((row) => row.label.startsWith('高剂量'))!;
    expect(high.adjustedP).toBeLessThan(0.05);
    expect(report.pairwiseSource).toBe('dunnett');
  });

  it('组内值少于 2 的组被剔除', () => {
    const report = compareGroups([
      { name: 'A', values: normalSample(10, 41) },
      { name: 'B', values: [3] },
    ]);
    expect(report.groupNames).toEqual(['A']);
  });

  it('强偏态数据给出非参数建议', () => {
    const next = mulberry32(51);
    const exp = () => -Math.log(Math.max(next(), 1e-12));
    const report = compareGroups([
      { name: 'A', values: Array.from({ length: 40 }, exp) },
      { name: 'B', values: Array.from({ length: 40 }, exp).map((v) => v * 3) },
    ]);
    expect(report.recommendation).toContain('非参数');
  });
});
