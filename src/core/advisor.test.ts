import { describe, expect, it } from 'vitest';
import { evaluateDiagnostics, type AdvisorContext } from './advisor.ts';
import type { AnalysisQc, AnalysisResult } from './types.ts';
import type { GroupStatsReport } from './analysis/statistics.ts';
import { createEmptyProject, DEFAULT_COLOC, type ProjectState } from './types.ts';

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
    result: overrides.result ?? baseResult(),
    qc: overrides.qc ?? defaultQc,
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

  it('共定位符号相反 → 掩膜优先警告', () => {
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
  });

  it('IF 模式不产生核分割/阈值类染色建议', () => {
    const project = { ...baseProject(), profileId: 'if_coloc' as const, coloc: DEFAULT_COLOC };
    const report = evaluateDiagnostics(ctx({ project, qc: null }));
    expect(report.issues.some((issue) => issue.message.includes('阳性面积'))).toBe(false);
  });

  it('统计组样本不足 → warn', () => {
    const stats = {
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
    expect(report.issues.some((issue) => issue.message.includes('样本数 <3'))).toBe(true);
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
