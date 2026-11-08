import { afterEach, describe, expect, it } from 'vitest';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { createEmptyProject, DEFAULT_THRESHOLD, type AnalysisResult } from './types.ts';
import { buildWorkbook, metricsCsv } from './export.ts';
import { setLanguage } from '../i18n.ts';
import { groupBarChartSvg } from './chart.ts';
import { compareGroups } from './analysis/statistics.ts';

afterEach(() => setLanguage('zh'));

const project = {
  ...createEmptyProject(),
  image: {
    name: 'sample1.tif',
    sourceType: 'TIFF16' as const,
    sourceWidth: 8000,
    sourceHeight: 6000,
    workingWidth: 4096,
    workingHeight: 3072,
    workingScale: 8000 / 4096,
    bitsPerSample: 16,
    note: '16bit TIFF 按 v/257 固定标尺映射到 8bit（未做对比度拉伸）',
  },
  threshold: { ...DEFAULT_THRESHOLD, mode: 'control' as const, controlThreshold: 42, controlImageName: 'control.tif' },
  calibration: { mpp: 0.5 },
};

const result: AnalysisResult = {
  requestId: 1,
  overall: {
    roiId: null,
    roiName: '整图',
    pixelCount: 100,
    positiveFraction: 0.2,
    positiveNuclei: 30,
    totalNuclei: 100,
    labelingIndex: 0.3,
    borderNuclei: 5,
    integratedOpticalDensity: 1234.5,
    meanOpticalDensity: 61.7,
    estimatedTotalCount: 106.3,
    densityPerMm2: 5120,
    hScore: 150,
  },
  perRoi: [],
  thresholdUsed: 42,
  nuclearThresholdUsed: 55,
  backgroundLevel: 3,
  overlay: null,
  coloc: null,
  qc: null,
  aiUsed: false,
  aiModelLoaded: null,
  warnings: [],
};

describe('generateMethodsZh / En', () => {
  it('withholds completed Methods while current analysis is unavailable', () => {
    expect(generateMethodsZh(project, null)).toContain('尚无有效分析结果');
    expect(generateMethodsEn(project, null)).toContain('No valid analysis result');
    expect(generateMethodsEn(project, null)).not.toContain('effective threshold');
  });
  it('records the actual AI identity or explicitly disclosed Otsu fallback in both languages', () => {
    const ai = { ...result, aiUsed: true, aiRequested: true, aiModelLoaded: 'nuclei.onnx', aiModelId: 'abc123' };
    expect(generateMethodsZh(project, ai)).toContain('内容 SHA-256：abc123');
    expect(generateMethodsEn(project, ai)).toContain('content SHA-256: abc123');
    expect(generateMethodsEn(project, ai)).not.toContain('Nuclei were segmented from the haematoxylin channel by per-image Otsu');
    expect(generateMethodsZh(project, { ...result, aiRequested: true })).toContain('Otsu 回落');
    expect(generateMethodsEn(project, { ...result, aiRequested: true })).toContain('Otsu fallback');
  });
  it('describes current IF channels and thresholds without claiming the stain pipeline was run', () => {
    const ifProject = { ...project, profileId: 'if_coloc' as const, coloc: { ...project.coloc, channelA: 2 as const, channelB: 0 as const } };
    const ifResult = { ...result, coloc: { channelA: 2, channelB: 0, backgroundA: 3, backgroundB: 4, thresholdA: 42, thresholdB: 55,
      pearsonAll: 0.3, pearsonMasked: 0.4, mandersM1: 0.5, mandersM2: 0.6 } };
    expect(generateMethodsZh(ifProject, ifResult)).toContain('B/R');
    expect(generateMethodsEn(ifProject, ifResult)).toContain('effective A/B thresholds 42/55');
    expect(generateMethodsEn(ifProject, ifResult)).not.toContain('DAB');
  });
  it('包含关键参数（去卷积、阈值、门控、标定）', () => {
    const zh = generateMethodsZh(project, result);
    expect(zh).toContain('Ruifrok');
    expect(zh).toContain('42');
    expect(zh).toContain('0.5 μm/px');
    expect(zh).toContain('v/257');
    expect(zh).toContain('control.tif');
    const en = generateMethodsEn(project, result);
    expect(en).toContain('Ruifrok');
    expect(en).toContain('v/257');
    expect(en).toContain('0.5 μm/px');
  });

  it('自定义向量在 Methods 中明示', () => {
    const customized = {
      ...project,
      stainOverrides: { h_dab: [[0.7, 0.68, 0.19], [0.26, 0.52, 0.81]] as [[number, number, number], [number, number, number]] },
    };
    const zh = generateMethodsZh(customized, result);
    expect(zh).toContain('用户自定义向量');
    expect(zh).toContain('0.700/0.680/0.190');
    const en = generateMethodsEn(customized, result);
    expect(en).toContain('user-adjusted');
  });

  it('对照片未标定时回落说明', () => {
    const fallback = generateMethodsZh(
      { ...project, threshold: { ...DEFAULT_THRESHOLD, mode: 'control', controlThreshold: null, controlImageName: null } },
      result,
    );
    expect(fallback).toContain('回落');
  });
});

describe('buildWorkbook', () => {
  it('exports explicit design and unit sheets without inferring from a supplied legacy report', () => {
    const report = compareGroups([
      { name: '对照', values: [0.1, 0.12, 0.11, 0.13] },
      { name: '处理', values: [0.2, 0.22, 0.21, 0.23] },
    ]);
    const book = buildWorkbook(
      [
        {
          id: 's1',
          name: 'S1',
          group: '对照',
          imageName: 'a.tif',
          addedAt: 0,
          metrics: result.overall,
        },
      ],
      report,
      project,
      result,
    );
    expect(book.SheetNames).toEqual(['样本指标', '实验单位', '切片汇总', '实验设计', '分组描述', 'Methods', '项目信息']);
  });
});

describe('metricsCsv', () => {
  it('H-score 表头跟随语言，数值与用户名称保持不变', () => {
    const samples = [{ id: 's1', name: '用户样本', group: '对照', imageName: '原始图.tif', addedAt: 0, metrics: result.overall }];
    const zh = metricsCsv(samples).replace(/^\uFEFF/, '').split('\n');
    setLanguage('en');
    const en = metricsCsv(samples).replace(/^\uFEFF/, '').split('\n');
    expect(zh[0].split(',').slice(0, 10)).toEqual('样本,分组,图像,阳性面积,阳性核,总核,标注指数,H-score,IOD,平均OD'.split(','));
    expect(en[0].split(',').slice(0, 10)).toEqual('Sample,Group,Image,Positive area,Positive nuclei,Total nuclei,Labeling index,H-score,IOD,Mean OD'.split(','));
    expect(en[1]).toBe(zh[1]);
    expect(en[1].split(',').slice(0, 3)).toEqual(['用户样本', '对照', '原始图.tif']);
    expect(en[1].split(',')[7]).toBe('150');
  });
});

describe('groupBarChartSvg', () => {
  it('生成合法描述 SVG，含组名与记录数', () => {
    const report = compareGroups([
      { name: '对照', values: [0.1, 0.12, 0.11, 0.13, 0.1, 0.14] },
      { name: '处理', values: [0.3, 0.32, 0.31, 0.33, 0.3, 0.34] },
    ]);
    const svg = groupBarChartSvg(report, { yLabel: '阳性面积', title: '测试图' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('对照');
    expect(svg).toContain('处理');
    expect(svg).toContain('nRecords=6');
  });
});
