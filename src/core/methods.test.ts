import { describe, expect, it } from 'vitest';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { createEmptyProject, DEFAULT_THRESHOLD, type AnalysisResult } from './types.ts';
import { buildWorkbook } from './export.ts';
import { groupBarChartSvg } from './chart.ts';
import { compareGroups } from './analysis/statistics.ts';

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
  },
  perRoi: [],
  thresholdUsed: 42,
  nuclearThresholdUsed: 55,
  backgroundLevel: 3,
  overlay: null,
  coloc: null,
  aiUsed: false,
  aiModelLoaded: null,
  warnings: [],
};

describe('generateMethodsZh / En', () => {
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
  it('生成四个工作表且不抛错', () => {
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
    expect(book.SheetNames).toEqual(['样本指标', '统计检验', 'Methods', '项目信息']);
  });
});

describe('groupBarChartSvg', () => {
  it('生成合法 SVG，含组名与显著性星标', () => {
    const report = compareGroups([
      { name: '对照', values: [0.1, 0.12, 0.11, 0.13, 0.1, 0.14] },
      { name: '处理', values: [0.3, 0.32, 0.31, 0.33, 0.3, 0.34] },
    ]);
    const svg = groupBarChartSvg(report, { yLabel: '阳性面积', title: '测试图' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('对照');
    expect(svg).toContain('处理');
    expect(svg).toContain('n=6');
  });
});
