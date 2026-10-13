/**
 * 组间比较编排：根据组数与假设检验条件选择参数/非参数路径。
 * 2 组：Welch t + Mann-Whitney；>2 组：ANOVA(+Dunnett 对首组) + Kruskal-Wallis(+Holm 校正的全对 Mann-Whitney)。
 */
import {
  dagostinoPearson,
  dunnettAdjustedP,
  holm,
  kruskalWallis,
  leveneTest,
  mannWhitneyU,
  mean,
  oneWayAnova,
  sd,
  significanceStars,
  welchTTest,
} from '../stats.ts';
import type { ValueGroup } from '../types.ts';

export interface OmnibusRow {
  label: string;
  statistic: number;
  df1: number | null;
  df2: number | null;
  p: number;
}

export interface PairwiseRow {
  label: string;
  p: number;
  adjustedP: number;
  method: 'dunnett' | 'holm-mw' | 'bonferroni';
}

export interface GroupStatsReport {
  groupNames: string[];
  ns: number[];
  means: number[];
  sds: number[];
  medians: number[];
  /** D'Agostino–Pearson，n<8 为 null */
  normality: Array<{ group: string; p: number | null }>;
  leveneP: number | null;
  omnibusParametric: OmnibusRow | null;
  omnibusNonParametric: OmnibusRow | null;
  pairwise: PairwiseRow[];
  /** 基于假设检验条件给出的解读建议 */
  recommendation: string;
  /** Dunnett 使用组内均方自由度（图表显著性引用） */
  pairwiseSource: 'dunnett' | 'holm-mw' | null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function compareGroups(groups: ValueGroup[]): GroupStatsReport {
  const valid = groups.filter((g) => g.values.length >= 2);
  const values = valid.map((g) => g.values);
  const names = valid.map((g) => g.name);
  const k = valid.length;

  const normality = valid.map((g) => ({
    group: g.name,
    p: dagostinoPearson(g.values)?.p ?? null,
  }));
  const allNormal = normality.every((item) => item.p !== null && item.p >= 0.05);
  const levene = k >= 2 ? leveneTest(values) : null;
  const leveneP = levene && Number.isFinite(levene.p) ? levene.p : null;
  const homoscedastic = leveneP === null || leveneP >= 0.05;

  let omnibusParametric: OmnibusRow | null = null;
  let omnibusNonParametric: OmnibusRow | null = null;
  const pairwise: PairwiseRow[] = [];
  let pairwiseSource: 'dunnett' | 'holm-mw' | null = null;

  if (k === 2) {
    const t = welchTTest(values[0], values[1]);
    omnibusParametric = {
      label: 'Welch t 检验（双侧）',
      statistic: t.t,
      df1: null,
      df2: t.df,
      p: t.p,
    };
    const mw = mannWhitneyU(values[0], values[1]);
    omnibusNonParametric = {
      label: 'Mann-Whitney U 检验（双侧）',
      statistic: mw.u,
      df1: null,
      df2: null,
      p: mw.p,
    };
  } else if (k > 2) {
    const anova = oneWayAnova(values);
    omnibusParametric = {
      label: '单因素 ANOVA',
      statistic: anova.f,
      df1: anova.df1,
      df2: anova.df2,
      p: anova.p,
    };
    const kw = kruskalWallis(values);
    omnibusNonParametric = {
      label: 'Kruskal-Wallis H 检验',
      statistic: kw.h,
      df1: kw.df,
      df2: null,
      p: kw.p,
    };

    // Dunnett：各组 vs 第一组（作为对照），合并方差取自 ANOVA
    if (Number.isFinite(anova.msWithin) && anova.msWithin > 0) {
      const n0 = values[0].length;
      const pooledSd = Math.sqrt(anova.msWithin);
      const comparisons = values.slice(1).map((vals) => {
        const t = (mean(vals) - mean(values[0])) / (pooledSd * Math.sqrt(1 / vals.length + 1 / n0));
        return { b: Math.sqrt(vals.length / n0), tAbs: Math.abs(t) };
      });
      const adjusted = dunnettAdjustedP(comparisons, anova.df2);
      comparisons.forEach((_, index) => {
        const tVsControl = welchTTest(values[index + 1], values[0]);
        pairwise.push({
          label: `${names[index + 1]} vs ${names[0]}（Dunnett）`,
          p: tVsControl.p,
          adjustedP: adjusted[index],
          method: 'dunnett',
        });
      });
      pairwiseSource = 'dunnett';
    }

    // 非参数全对：Mann-Whitney + Holm
    const mwPs: number[] = [];
    const mwLabels: string[] = [];
    for (let i = 0; i < k; i += 1) {
      for (let j = i + 1; j < k; j += 1) {
        mwPs.push(mannWhitneyU(values[i], values[j]).p);
        mwLabels.push(`${names[j]} vs ${names[i]}`);
      }
    }
    const holmAdjusted = holm(mwPs);
    mwLabels.forEach((label, index) => {
      pairwise.push({
        label: `${label}（Mann-Whitney + Holm）`,
        p: mwPs[index],
        adjustedP: holmAdjusted[index],
        method: 'holm-mw',
      });
    });
    if (pairwiseSource === null && mwLabels.length > 0) pairwiseSource = 'holm-mw';
  }

  let recommendation: string;
  if (allNormal && homoscedastic) {
    recommendation = '各组近似正态且方差齐，建议采用参数检验（Welch t / ANOVA + Dunnett）。';
  } else if (!allNormal && homoscedastic) {
    recommendation = '至少一组偏离正态分布（D\'Agostino–Pearson），建议以非参数检验（Mann-Whitney / Kruskal-Wallis）为主要依据。';
  } else if (allNormal && !homoscedastic) {
    recommendation = '组间方差不齐（Brown–Forsythe），建议采用 Welch t / ANOVA（对异方差稳健）并谨慎解释 Dunnett 结果。';
  } else {
    recommendation = '正态性与方差齐性均不满足，建议以非参数检验为主要依据。';
  }

  return {
    groupNames: names,
    ns: values.map((v) => v.length),
    means: values.map((v) => mean(v)),
    sds: values.map((v) => sd(v)),
    medians: values.map((v) => median(v)),
    normality,
    leveneP,
    omnibusParametric,
    omnibusNonParametric,
    pairwise,
    recommendation,
    pairwiseSource,
  };
}

export { significanceStars };
