import { describe, expect, it } from 'vitest';
import { evaluateDiagnostics, type AdvisorContext } from './advisor.ts';
import type { AnalysisQc, AnalysisResult } from './types.ts';
import type { GroupStatsReport } from './analysis/statistics.ts';
import { compareGroups } from './analysis/statistics.ts';
import { computeColocalizationRegions } from './analysis/colocalize.ts';
import { createEmptyProject, DEFAULT_COLOC, type ProjectState } from './types.ts';
import { t } from '../i18n.ts';

function baseProject(): ProjectState {
  return {
    ...createEmptyProject(),
    image: {
      name: 'a.png',
      sourceType: 'PNG',
      sourceWidth: 1200,
      sourceHeight: 900,
      workingWidth: 1200,
      workingHeight: 900,
      workingScale: 1,
      bitsPerSample: 8,
    },
  };
}

const defaultQc: AnalysisQc = {
  tissueFraction: 0.5,
  saturatedFraction: 0,
  otsuSeparation: 1.2,
  rejectedByArea: 0,
  rejectedByCircularity: 0,
  borderFraction: 0.1,
};

function baseResult(): AnalysisResult {
  return {
    requestId: 1,
    overall: {
      roiId: null,
      roiName: '整图',
      pixelCount: 100000,
      positiveFraction: 0.15,
      positiveNuclei: 40,
      totalNuclei: 100,
      labelingIndex: 0.4,
      borderNuclei: 3,
      integratedOpticalDensity: 900,
      meanOpticalDensity: 60,
      estimatedTotalCount: 103,
      densityPerMm2: null,
      hScore: 120,
    },
    perRoi: [],
    thresholdUsed: 50,
    nuclearThresholdUsed: 40,
    backgroundLevel: 4,
    overlay: null,
    coloc: null,
    qc: null,
    aiUsed: false,
    aiModelLoaded: null,
    warnings: [],
  };
}

function ctx(overrides: Partial<AdvisorContext> & { project?: ProjectState }): AdvisorContext {
  return {
    project: overrides.project ?? baseProject(),
    result: overrides.result === undefined ? baseResult() : overrides.result,
    qc: overrides.qc === undefined ? defaultQc : overrides.qc,
    statsReport: overrides.statsReport ?? null,
  };
}

describe('evaluateDiagnostics', () => {
  it('健康配置：无 warn/error，评分接近满分', () => {
    const report = evaluateDiagnostics(ctx({}));
    expect(report.issues.some((issue) => issue.severity === 'warn' || issue.severity === 'error')).toBe(false);
    expect(report.score).toBeGreaterThan(80);
    expect(report.summary).toContain('可选优化');
  });

  it('阳性面积异常偏高 → 阈值警告 + 微调建议', () => {
    const result = baseResult();
    result.overall.positiveFraction = 0.75;
    const report = evaluateDiagnostics(ctx({ result }));
    const issue = report.issues.find((issue) => issue.message.includes('异常偏高'));
    expect(issue?.severity).toBe('warn');
    expect(issue?.suggestion).toContain('微调');
  });

  it('阳性面积接近零 → 建议切换 Otsu', () => {
    const result = baseResult();
    result.overall.positiveFraction = 0.0001;
    const report = evaluateDiagnostics(ctx({ result }));
    expect(report.issues.some((issue) => issue.suggestion?.includes('Otsu'))).toBe(true);
  });

  it('Otsu 分离度低 + auto 模式 → 建议对照片标定', () => {
    const report = evaluateDiagnostics(ctx({ qc: { ...defaultQc, otsuSeparation: 0.2 } }));
    const issue = report.issues.find((issue) => issue.message.includes('分离度低'));
    expect(issue?.severity).toBe('warn');
    expect(issue?.suggestion).toContain('对照片');
  });

  it('对照片模式未标定 → warn', () => {
    const project = baseProject();
    project.threshold = { ...project.threshold, mode: 'control', controlThreshold: null };
    const report = evaluateDiagnostics(ctx({ project }));
    expect(report.issues.some((issue) => issue.message.includes('尚未标定'))).toBe(true);
  });

  it('DAB 阈值低于核复染阈值 → 弱阳性高估警告', () => {
    const result = baseResult();
    result.thresholdUsed = 13;
    result.nuclearThresholdUsed = 15;
    const report = evaluateDiagnostics(ctx({ result }));
    const issue = report.issues.find((issue) => issue.message.includes('低于核复染阈值'));
    expect(issue?.severity).toBe('warn');
    expect(issue?.suggestion).toContain('labeling index');
    expect(t(issue!.message, 'en')).toBe('DAB quantification threshold (13) is below the nuclear counterstain threshold (15)');
    expect(t(issue!.suggestion!, 'en')).not.toMatch(/[\u4e00-\u9fff]/);
    expect(t(issue!.suggestion!, 'en')).toContain('labeling index');
  });

  it.each(['h_eosin', 'masson', 'if_coloc'] as const)('%s 不显示 DAB 特有的阈值警告', (profileId) => {
    const result = baseResult();
    result.thresholdUsed = 13;
    result.nuclearThresholdUsed = 15;
    const project = { ...baseProject(), profileId };
    const report = evaluateDiagnostics(ctx({ project, result }));
    expect(report.issues.some((issue) => issue.message.includes('DAB'))).toBe(false);
  });

  it('饱和像素过多 → 过曝警告', () => {
    const report = evaluateDiagnostics(ctx({ qc: { ...defaultQc, saturatedFraction: 0.12 } }));
    expect(report.issues.some((issue) => issue.message.includes('饱和'))).toBe(true);
  });

  it('组织占比过低 → 建议框选 ROI', () => {
    const report = evaluateDiagnostics(ctx({ qc: { ...defaultQc, tissueFraction: 0.04 } }));
    expect(report.issues.some((issue) => issue.suggestion?.includes('框选 ROI'))).toBe(true);
  });

  it('零核 + 有门控拒绝 → warn 与放宽门控建议', () => {
    const result = baseResult();
    result.overall.totalNuclei = 0;
    result.overall.positiveNuclei = 0;
    const report = evaluateDiagnostics(ctx({
      result,
      qc: { ...defaultQc, rejectedByArea: 30, rejectedByCircularity: 5 },
    }));
    const issue = report.issues.find((issue) => issue.message.includes('未检出任何细胞核'));
    expect(issue).toBeDefined();
    expect(issue?.suggestion).toContain('放宽最小面积');
  });

  it('触边比例高 → 边界折算提示', () => {
    const report = evaluateDiagnostics(ctx({ qc: { ...defaultQc, borderFraction: 0.45 } }));
    expect(report.issues.some((issue) => issue.message.includes('边界相交'))).toBe(true);
  });

  it('未标定 mpp → 密度提示', () => {
    const report = evaluateDiagnostics(ctx({}));
    expect(report.issues.some((issue) => issue.message.includes('未标定像素尺寸'))).toBe(true);
  });

  it('different finite Pearson signs prompt a scope check without declaring one scientifically preferable', () => {
    const project = { ...baseProject(), profileId: 'if_coloc' as const, coloc: DEFAULT_COLOC };
    const result = baseResult();
    result.coloc = {
      channelA: 0, channelB: 1,
      pearsonAll: 0.5, pearsonMasked: -0.6,
      mandersM1: 0.3, mandersM2: 0.3,
      thresholdA: 40, thresholdB: 40, backgroundA: 5, backgroundB: 5,
    };
    const report = evaluateDiagnostics(ctx({ project, result, qc: null }));
    expect(report.issues.some((issue) => issue.message.includes('符号相反'))).toBe(true);
    expect(report.issues.find((issue) => issue.message.includes('符号相反'))?.suggestion).toContain('符号差异不能证明背景主导');
    expect(report.issues.some((issue) => issue.suggestion?.includes('掩膜 Pearson 为准'))).toBe(false);
  });

  it('IF 模式不产生核分割/阈值类染色建议', () => {
    const project = { ...baseProject(), profileId: 'if_coloc' as const, coloc: DEFAULT_COLOC };
    const report = evaluateDiagnostics(ctx({ project, qc: null }));
    expect(report.issues.some((issue) => issue.message.includes('阳性面积'))).toBe(false);
  });

  it('统计组样本不足 → warn', () => {
    const stats = {
      designStatus: 'confirmed', controlGroup: '对照', inferenceStatus: 'blocked', issues: [],
      groupNames: ['对照', '处理'],
      ns: [2, 1],
      means: [0.1, 0.2],
      sds: [0.01, 0.02],
      medians: [0.1, 0.2],
      normality: [],
      leveneP: null,
      omnibusParametric: null,
      omnibusNonParametric: null,
      pairwise: [],
      recommendation: '',
      pairwiseSource: null,
    } as unknown as GroupStatsReport;
    const report = evaluateDiagnostics(ctx({ statsReport: stats }));
    const issue = report.issues.find((issue) => issue.message.includes('独立单位数 <3'));
    expect(issue?.message).toContain('nBio=');
    expect(issue?.suggestion).toContain('目标检验效力');
    expect(issue?.suggestion).not.toContain('≥5');
  });

  it('uses canonical undefined reasons instead of legacy zeros or sign comparisons', () => {
    const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const measured = computeColocalizationRegions(pixels, DEFAULT_COLOC, [{ id: 'roi', name: '用户区域', x: 0, y: 0, w: 1, h: 1 }]);
    const result = { ...baseResult(), ifAnalysis: measured.ifAnalysis, coloc: { ...measured.coloc, pearsonAll: 0.8, pearsonMasked: 0 } };
    const project = { ...baseProject(), profileId: 'if_coloc' as const };
    const report = evaluateDiagnostics(ctx({ project, result, qc: null }));
    expect(report.issues.some((issue) => issue.message === 'Manders M1：区域 A 总强度为零。')).toBe(true);
    expect(report.issues.some((issue) => issue.message === '全像素 Pearson：有效像素少于 2 个。')).toBe(true);
    expect(report.issues.some((issue) => /符号相反|线性相关接近零|共定位很弱/.test(issue.message))).toBe(false);
    expect(report.issues.filter((issue) => issue.message === '掩膜 Pearson：并集内像素少于 2 个。')).toHaveLength(1);
  });

  it('gives IF-specific low-resolution and saved-library advice without stain or group-test suggestions', () => {
    const measured = computeColocalizationRegions({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, DEFAULT_COLOC);
    const project = { ...baseProject(), profileId: 'if_coloc' as const };
    project.image = { ...project.image!, workingWidth: 2, workingHeight: 2 };
    project.pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 } as ImageData;
    project.ifSamples = [{ id: 'if1', name: '保存的 IF', group: '处理', imageName: 'if.png', addedAt: 0, sourceId: 'sha256:if', profileId: 'if_coloc', image: project.image, config: DEFAULT_COLOC, analysis: measured.ifAnalysis }];
    const report = evaluateDiagnostics(ctx({ project, result: { ...baseResult(), ifAnalysis: measured.ifAnalysis }, qc: { ...defaultQc, tissueFraction: 0.01, saturatedFraction: 0.5 } }));
    expect(report.issues.find((issue) => issue.message.includes('最长边'))?.suggestion).toContain('ROI 内有效像素数');
    expect(report.issues.some((issue) => issue.message === 'IF 当前仅提供描述统计')).toBe(true);
    expect(report.issues.map((issue) => `${issue.message} ${issue.suggestion}`).join('\n')).not.toMatch(/核分割|阳性面积|样本库为空|批处理导入/);
    for (const issue of report.issues) expect(t(issue.message, 'en') + t(issue.suggestion ?? '', 'en')).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('does not equate low finite correlation with biological colocalization or tune thresholds to expectations', () => {
    const measured = computeColocalizationRegions({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, DEFAULT_COLOC);
    const result = { ...baseResult(), coloc: { ...measured.coloc, pearsonAll: 0.6, pearsonMasked: 0 } };
    const report = evaluateDiagnostics(ctx({ project: { ...baseProject(), profileId: 'if_coloc' }, result, qc: null }));
    const issue = report.issues.find((issue) => issue.message.includes('线性相关接近零'));
    expect(issue?.suggestion).toContain('不能单独判断生物学共定位');
    expect(issue?.suggestion).toContain('预先确定');
    expect(report.issues.some((item) => item.message.includes('符号相反'))).toBe(false);
    expect(report.issues.some((item) => item.suggestion?.includes('若预期'))).toBe(false);
  });

  it('does not call ordinary ANOVA robust to unequal variances', () => {
    const stats = compareGroups([{ name: '对照', values: [1, 2, 3] }, { name: '处理', values: [2, 5, 8] }], { designStatus: 'confirmed', controlGroup: '对照' });
    stats.leveneP = 0.01;
    const report = evaluateDiagnostics(ctx({ statsReport: stats }));
    expect(report.issues.find((issue) => issue.message.includes('方差不齐'))?.suggestion).toContain('普通 ANOVA 与 Dunnett 不属于异方差稳健检验');
    const descriptive = compareGroups([{ name: '未确认', values: [1] }]);
    expect(evaluateDiagnostics(ctx({ statsReport: descriptive })).issues.some((issue) => issue.message.includes('独立单位数'))).toBe(false);
  });

  it('空样本库 → 提示加入样本', () => {
    const project = baseProject();
    project.pixels = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;
    const report = evaluateDiagnostics(ctx({ project }));
    expect(report.issues.some((issue) => issue.message.includes('样本库为空'))).toBe(true);
  });

  it('评分始终为 0–100 的有限数', () => {
    const report = evaluateDiagnostics(ctx({}));
    expect(Number.isFinite(report.score)).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.summary.length).toBeGreaterThan(0);
  });
});
