import { describe, expect, it } from 'vitest';
import { compareGroups } from './statistics.ts';
import { mean, oneWayAnova, studentTCdf, welchTTest } from '../stats.ts';
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

function confirmed(groups: ValueGroup[], controlGroup = groups[0]?.name) {
  return compareGroups(groups, { designStatus: 'confirmed', controlGroup });
}

describe('compareGroups', () => {
  it('两组：给出 Welch t 与 Mann-Whitney 双路径且显著性一致', () => {
    const report = confirmed(twoNormal);
    expect(report.omnibusParametric?.label).toContain('Welch');
    expect(report.omnibusNonParametric?.label).toContain('Mann-Whitney');
    expect(report.omnibusParametric!.p).toBeLessThan(0.05);
    expect(report.omnibusNonParametric!.p).toBeLessThan(0.05);
    expect(report.pairwise).toHaveLength(0);
    expect(report.leveneP).not.toBeNull();
    expect(report.recommendation).toContain('参数');
  });

  it('两组无差异：p 均不显著', () => {
    const report = confirmed([
      { name: 'A', values: normalSample(12, 21) },
      { name: 'B', values: normalSample(12, 22) },
    ]);
    expect(report.omnibusParametric!.p).toBeGreaterThan(0.05);
    expect(report.omnibusNonParametric!.p).toBeGreaterThan(0.05);
  });

  it('三组显著差异：ANOVA + Kruskal-Wallis + Dunnett/Holm 两两比较', () => {
    const report = confirmed([
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

  it('组内单位不足不静默删组，并阻止推断', () => {
    const report = confirmed([
      { name: 'A', values: normalSample(10, 41) },
      { name: 'B', values: [3] },
    ]);
    expect(report.groupNames).toEqual(['A', 'B']);
    expect(report.ns).toEqual([10, 1]);
    expect(report.inferenceStatus).toBe('blocked');
    expect(report.omnibusParametric).toBeNull();
    expect(report.omnibusNonParametric).toBeNull();
  });

  it('强偏态数据给出非参数建议', () => {
    const next = mulberry32(51);
    const exp = () => -Math.log(Math.max(next(), 1e-12));
    const report = confirmed([
      { name: 'A', values: Array.from({ length: 40 }, exp) },
      { name: 'B', values: Array.from({ length: 40 }, exp).map((v) => v * 3) },
    ]);
    expect(report.recommendation).toContain('非参数');
  });
});


describe('explicit statistical boundaries', () => {
  it('does not infer from legacy value arrays without design confirmation', () => {
    const report = compareGroups(twoNormal);
    expect(report.inferenceStatus).toBe('descriptive');
    expect(report.normality.every((test) => test.p === null)).toBe(true);
    expect(report.leveneP).toBeNull();
    expect(report.omnibusParametric).toBeNull();
    expect(report.pairwise).toEqual([]);
  });

  it('requires an explicit existing control and puts it first regardless of input order', () => {
    const absent = compareGroups(twoNormal, { designStatus: 'confirmed' });
    expect(absent.inferenceStatus).toBe('blocked');
    const reordered = confirmed([twoNormal[1], twoNormal[0]], '对照');
    expect(reordered.groupNames).toEqual(['对照', '处理']);
    expect(reordered.omnibusParametric?.p).toBeCloseTo(confirmed(twoNormal).omnibusParametric!.p, 12);
  });

  it('small-n normality is unknown, not evidence of non-normality', () => {
    const report = confirmed([{ name: 'C', values: [1, 2, 3] }, { name: 'T', values: [3, 4, 5] }]);
    expect(report.normality.every((item) => item.p === null)).toBe(true);
    expect(report.recommendation).toContain('正态性未知');
    expect(report.recommendation).not.toContain('至少一组正态性检验检出偏离');
    expect(report.issues.some((i) => i.code === 'NORMALITY_UNKNOWN')).toBe(true);
  });

  it('does not call ordinary ANOVA robust to detected heteroscedasticity', () => {
    const report = confirmed([
      { name: 'C', values: normalSample(40, 80) },
      { name: 'T1', values: normalSample(40, 81, 1) },
      { name: 'T2', values: normalSample(40, 82).map((v) => v * 30) },
    ]);
    expect(report.leveneP!).toBeLessThan(0.05);
    expect(report.omnibusParametric).toBeNull();
    expect(report.pairwise.some((row) => row.method === 'dunnett')).toBe(false);
    expect(report.omnibusNonParametric).not.toBeNull();
    expect(report.recommendation).toContain('未实现 Welch ANOVA');
    expect(report.recommendation).not.toContain('对异方差稳健');
  });

  it('Dunnett raw and adjusted p share the pooled statistic and ANOVA degrees of freedom', () => {
    const groups = [
      { name: 'C', values: [1, 2, 3] },
      { name: 'T1', values: [2, 3, 4, 5, 6] },
      { name: 'T2', values: [5, 6, 7, 8] },
    ];
    const report = confirmed(groups);
    expect(report.omnibusParametric).not.toBeNull();
    const anova = oneWayAnova(groups.map((group) => group.values));
    const t = Math.abs((mean(groups[1].values) - mean(groups[0].values)) / Math.sqrt(anova.msWithin * (1 / 5 + 1 / 3)));
    const expected = 2 * (1 - studentTCdf(t, anova.df2));
    const result = report.pairwise.find((row) => row.method === 'dunnett' && row.label.startsWith('T1'))!;
    expect(result.groupA).toBe('T1');
    expect(result.groupB).toBe('C');
    expect(report.pairwise.filter((row) => row.method === 'holm-mw').every((row) => row.groupA && row.groupB)).toBe(true);
    expect(result.p).toBeCloseTo(expected, 12);
    expect(Math.abs(result.p - welchTTest(groups[1].values, groups[0].values).p)).toBeGreaterThan(1e-4);
    expect(result.adjustedP).toBeGreaterThanOrEqual(result.p - 1e-6);
  });

  it('keeps empty groups and blocks nonfinite observations instead of changing group membership', () => {
    const empty = confirmed([{ name: 'C', values: [1, 2, 3] }, { name: 'T', values: [] }]);
    expect(empty.groupNames).toEqual(['C', 'T']);
    expect(empty.ns).toEqual([3, 0]);
    expect(empty.inferenceStatus).toBe('blocked');
    const invalid = confirmed([{ name: 'C', values: [1, 2, NaN] }, { name: 'T', values: [3, 4, 5] }]);
    expect(invalid.inferenceStatus).toBe('blocked');
    expect(invalid.issues.some((i) => i.code === 'NONFINITE_UNIT_VALUES')).toBe(true);
  });
});
