/**
 * 仅在独立单位设计确认且所有预声明组数据足够时提供组间检验。
 * 2 组：Welch t + Mann-Whitney；>2 组：ANOVA/Dunnett 对显式对照组，以及 Kruskal-Wallis/Holm-Mann-Whitney。
 * 普通 ANOVA/Dunnett 不在已检出异方差时计算；正态性未知不等同于检出偏离。
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
  studentTCdf,
  welchTTest,
} from '../stats.ts';
import type { PathologyDesignIssue, PathologyDesignStatus, ValueGroup } from '../types.ts';

export interface OmnibusRow {
  label: string;
  statistic: number;
  df1: number | null;
  df2: number | null;
  p: number;
}

export interface PairwiseRow {
  label: string;
  groupA?: string;
  groupB?: string;
  p: number;
  adjustedP: number;
  method: 'dunnett' | 'holm-mw' | 'bonferroni';
}

export interface GroupStatsReport {
  designStatus: PathologyDesignStatus;
  controlGroup: string | null;
  inferenceStatus: 'descriptive' | 'blocked' | 'available';
  issues: PathologyDesignIssue[];
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

export interface GroupComparisonOptions {
  designStatus?: PathologyDesignStatus;
  controlGroup?: string;
}

/** Values must already be biological-unit summaries before confirming inference. */
export function compareGroups(groups: ValueGroup[], options: GroupComparisonOptions = {}): GroupStatsReport {
  const designStatus = options.designStatus ?? 'unconfirmed';
  const controlGroup = options.controlGroup ?? null;
  // Never silently remove a group. Nonfinite observations block inference below.
  const ordered = [...groups].sort((a, b) => Number(b.name === controlGroup) - Number(a.name === controlGroup));
  const values = ordered.map((group) => group.values.filter(Number.isFinite));
  const names = ordered.map((group) => group.name);
  const k = ordered.length;
  const report: GroupStatsReport = {
    designStatus, controlGroup, inferenceStatus: 'descriptive', issues: [],
    groupNames: names, ns: values.map((group) => group.length),
    means: values.map(mean), sds: values.map(sd), medians: values.map(median),
    normality: names.map((group) => ({ group, p: null })), leveneP: null,
    omnibusParametric: null, omnibusNonParametric: null, pairwise: [],
    recommendation: '', pairwiseSource: null,
  };
  const blocked = (code: string, message: string): GroupStatsReport => {
    report.inferenceStatus = 'blocked';
    report.issues.push({ code, message });
    report.recommendation = message;
    return report;
  };
  if (designStatus !== 'confirmed') {
    report.recommendation = designStatus === 'unsupported'
      ? '配对和重复测量设计当前仅提供描述，不进行独立组推断。'
      : '实验单位设计未确认或无效；当前仅显示描述值，不计算组间 p 值。';
    return report;
  }
  if (!controlGroup || !names.includes(controlGroup)) {
    return blocked('CONTROL_GROUP_MISSING', '缺少明确且存在的对照组；不进行组间推断。');
  }
  if (new Set(names).size !== names.length || names.some((name) => !name.trim())) {
    return blocked('GROUP_NAMES_INVALID', '组别名称为空或重复；请先核对分组。');
  }
  if (ordered.some((group) => group.values.some((value) => !Number.isFinite(value)))) {
    return blocked('NONFINITE_UNIT_VALUES', '组内含非有限单位值；不能静默删除这些数值后继续推断。');
  }
  if (k < 2 || values.some((group) => group.length < 2)) {
    return blocked('INSUFFICIENT_BIOLOGICAL_REPLICATION', '至少需要两个组，且每个预声明组至少有两个有效独立单位；空组或不足的组不会被静默剔除。');
  }
  report.normality = ordered.map((group) => {
    const p = dagostinoPearson(group.values)?.p;
    return { group: group.name, p: p !== undefined && Number.isFinite(p) ? p : null };
  });
  const normalityUnknown = report.normality.some((item) => item.p === null);
  const normalityRejected = report.normality.some((item) => item.p !== null && item.p < 0.05);
  const levene = leveneTest(values);
  report.leveneP = Number.isFinite(levene.p) ? levene.p : null;
  const heterogeneous = report.leveneP !== null && report.leveneP < 0.05;
  const withinVariation = report.sds.some((value) => value > 0);

  if (k === 2) {
    if (withinVariation) {
      const test = welchTTest(values[1], values[0]);
      if (Number.isFinite(test.p)) report.omnibusParametric = {
        label: 'Welch t 检验（双侧）', statistic: test.t, df1: null, df2: test.df, p: test.p,
      };
    }
    const mw = mannWhitneyU(values[0], values[1]);
    if (Number.isFinite(mw.p)) report.omnibusNonParametric = {
      label: 'Mann-Whitney U 检验（双侧）', statistic: mw.u, df1: null, df2: null, p: mw.p,
    };
  } else {
    // Ordinary ANOVA/Dunnett assume a common variance; they are not Welch ANOVA.
    if (!heterogeneous && withinVariation) {
      const anova = oneWayAnova(values);
      if (Number.isFinite(anova.p) && anova.msWithin > 0 && anova.df2 > 0) {
        report.omnibusParametric = {
          label: '单因素 ANOVA', statistic: anova.f, df1: anova.df1, df2: anova.df2, p: anova.p,
        };
        const n0 = values[0].length;
        const comparisons = values.slice(1).map((group) => ({
          b: Math.sqrt(group.length / n0),
          tAbs: Math.abs((mean(group) - mean(values[0])) / (Math.sqrt(anova.msWithin) * Math.sqrt(1 / group.length + 1 / n0))),
        }));
        const adjusted = dunnettAdjustedP(comparisons, anova.df2);
        comparisons.forEach((comparison, index) => {
          if (!Number.isFinite(adjusted[index])) return;
          // The raw and adjusted p values use the same pooled t statistic and df.
          const rawP = Math.min(1, Math.max(0, 2 * (1 - studentTCdf(comparison.tAbs, anova.df2))));
          report.pairwise.push({ label: `${names[index + 1]} vs ${names[0]}（Dunnett）`,
            groupA: names[index + 1], groupB: names[0],
            p: rawP, adjustedP: adjusted[index], method: 'dunnett' });
        });
        if (report.pairwise.length) report.pairwiseSource = 'dunnett';
      }
    }
    const kw = kruskalWallis(values);
    if (Number.isFinite(kw.p)) report.omnibusNonParametric = {
      label: 'Kruskal-Wallis H 检验', statistic: kw.h, df1: kw.df, df2: null, p: kw.p,
    };
    const comparisons: Array<{ label: string; groupA: string; groupB: string; p: number }> = [];
    for (let i = 0; i < k; i += 1) for (let j = i + 1; j < k; j += 1) {
      comparisons.push({ label: `${names[j]} vs ${names[i]}`, groupA: names[j], groupB: names[i], p: mannWhitneyU(values[i], values[j]).p });
    }
    if (comparisons.every((comparison) => Number.isFinite(comparison.p))) {
      const adjusted = holm(comparisons.map((comparison) => comparison.p));
      comparisons.forEach((comparison, index) => report.pairwise.push({
        label: `${comparison.label}（Mann-Whitney + Holm）`, p: comparison.p, adjustedP: adjusted[index], method: 'holm-mw',
        groupA: comparison.groupA, groupB: comparison.groupB,
      }));
      if (report.pairwiseSource === null && comparisons.length) report.pairwiseSource = 'holm-mw';
    }
    if (heterogeneous) report.issues.push({ code: 'HETEROSCEDASTICITY', message: '检测到组间方差不齐；普通 ANOVA 和 Dunnett 未计算，当前未实现 Welch ANOVA。' });
  }
  if (!withinVariation) report.issues.push({ code: 'WITHIN_VARIANCE_UNAVAILABLE', message: '单位级组内方差为零；不报告依赖组内方差的参数检验。' });
  if (normalityUnknown) report.issues.push({ code: 'NORMALITY_UNKNOWN', message: '至少一组样本量小于 8 或正态性检验不可计算；正态性未知，不等于偏离正态。' });

  const normalityText = normalityRejected
    ? '至少一组正态性检验检出偏离；请结合预声明分析方案和实际分布解释。'
    : normalityUnknown
      ? '正态性未知：小样本或不可计算的检验不能据此认定偏离正态。'
      : '正态性检验未检出偏离；这不证明数据服从正态分布。';
  const varianceText = heterogeneous
    ? k === 2
      ? '检测到方差不齐；两组 Welch t 允许不等方差。'
      : '检测到方差不齐；普通 ANOVA/Dunnett 未计算，未实现 Welch ANOVA。非参数检验也不自动消除分布尺度差异。'
    : report.leveneP === null
      ? '方差齐性检验不可计算，不能据此确认方差相等。'
      : '方差齐性检验未检出差异；这不证明方差相等。';
  report.recommendation = `${normalityText}${varianceText}参数与非参数结果应依据预声明方案解释，不能按显著性择优报告。`;
  report.inferenceStatus = report.omnibusParametric || report.omnibusNonParametric ? 'available' : 'blocked';
  return report;
}

export { significanceStars };
