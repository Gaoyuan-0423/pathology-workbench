import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { setLanguage } from '../i18n.ts';
import { buildFullReport, ifReportData } from './api.ts';
import { buildWorkbook, ifMetricsCsv, ifUnitMetricsCsv } from './export.ts';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { evaluateDiagnostics } from './advisor.ts';
import { ifSampleStatistics, type IfExperimentalDesign } from './if-statistics.ts';
import { compareGroups } from './analysis/statistics.ts';
import { createEmptyProject, type AnalysisResult, type IfAnalysisResult, type IfRegionResult, type IfSampleRecord, type LoadedImage, type ProjectState } from './types.ts';

afterEach(() => setLanguage('zh'));

function fixture() {
  const image: LoadedImage = { name: '当前图.tif', sourceType: 'TIFF16', sourceWidth: 8, sourceHeight: 6, workingWidth: 4, workingHeight: 3, workingScale: 2, bitsPerSample: 16 };
  const overall: IfRegionResult = { roiId: null, roiName: '整图', rect: { x: 0, y: 0, w: 4, h: 3 }, pixelCount: 12,
    positivePixelsA: 7, positivePixelsB: 5, unionPixels: 9, intersectionPixels: 3, channelA: 2, channelB: 0,
    thresholdA: 11, thresholdB: 22, backgroundA: 3, backgroundB: 4, pearsonAll: 0.7, pearsonMasked: 0.55, mandersM1: 0.2, mandersM2: 0.5,
    sumA: 100, sumB: 120, sumAInBPositive: 20, sumBInAPositive: 60, undefinedReasons: [] };
  const roi: IfRegionResult = { ...overall, roiId: 'roi-actual', roiName: '图中,区域甲', rect: { x: 1, y: 1, w: 2, h: 1 }, pixelCount: 2,
    positivePixelsA: 0, positivePixelsB: 0, unionPixels: 0, intersectionPixels: 0,
    pearsonAll: null, pearsonMasked: null, mandersM1: null, mandersM2: null,
    sumA: 0, sumB: 0, sumAInBPositive: 0, sumBInAPositive: 0,
    undefinedReasons: ['pearson_all_zero_variance', 'pearson_masked_insufficient_pixels', 'manders_m1_zero_denominator', 'manders_m2_zero_denominator'] };
  const ifAnalysis: IfAnalysisResult = { schemaVersion: 'wisplab.if-colocalization/v1', normalizationScope: 'whole_image', imageWidth: 4, imageHeight: 3, overall, perRoi: [roi] };
  const result: AnalysisResult = { requestId: 1, overall: { roiId: null, roiName: 'Compatibility', pixelCount: 12, positiveFraction: 0.99, positiveNuclei: 0, totalNuclei: 0,
    labelingIndex: null, integratedOpticalDensity: 0, meanOpticalDensity: null, borderNuclei: 0, estimatedTotalCount: null, densityPerMm2: null, hScore: null },
    perRoi: [], thresholdUsed: 199, nuclearThresholdUsed: 188, backgroundLevel: 0, overlay: null, qc: null, aiUsed: false, aiModelLoaded: null, warnings: [],
    coloc: { channelA: 0, channelB: 1, thresholdA: 199, thresholdB: 188, backgroundA: 0, backgroundB: 0, pearsonAll: 0.99, pearsonMasked: 0.99, mandersM1: 0, mandersM2: 0 }, ifAnalysis };
  const project: ProjectState = { ...createEmptyProject(), image, profileId: 'if_coloc', coloc: { channelA: 2, channelB: 0, thresholdMode: 'auto', manualA: 40, manualB: 40, backgroundPercentile: 5 },
    // A drawn region absent from the actual result must never become an exported measurement.
    rois: [{ id: 'not-measured', name: '未测量 ROI', x: 0, y: 0, w: 1, h: 1 }] };
  const savedAnalysis: IfAnalysisResult = { ...ifAnalysis, perRoi: [], overall: { ...overall, thresholdA: 33, thresholdB: 44, backgroundA: 9, backgroundB: 10 } };
  const sample: IfSampleRecord = { id: 'saved-if', name: '历史样本', group: '对照组', imageName: '历史图.tif', addedAt: 123, sourceId: 'sha256:historical', profileId: 'if_coloc',
    image: { ...image, name: '历史图.tif' }, config: { ...project.coloc, thresholdMode: 'manual', manualA: 33, manualB: 44, backgroundPercentile: 15 }, analysis: savedAnalysis };
  project.ifSamples = [sample];
  return { project, result, sample, ifAnalysis };
}

function table(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

function studyFixture() {
  const { project, result, sample } = fixture();
  const records = [
    ['c1-a', '对照组', 'c1', 'a', 0.1], ['c1-b', '对照组', 'c1', 'a', 0.3], ['c1-c', '对照组', 'c1', 'b', 0.8],
    ['c2', '对照组', 'c2', 'a', 0.2], ['t1', '处理组', 't1', 'a', 0.65], ['t2', '处理组', 't2', 'a', 0.85],
  ] as const;
  const samples: IfSampleRecord[] = records.map(([id, group, , , value]) => ({ ...sample, id, name: `记录 ${id}`, group, sourceId: `sha256:${id}`,
    analysis: { ...sample.analysis, overall: { ...sample.analysis.overall, pearsonMasked: value } } }));
  samples.push({ ...samples[0], id: 'c1-duplicate', name: '重复记录' });
  samples.push({ ...sample, id: 'excluded', name: '排除记录', sourceId: 'sha256:excluded', excludedFromStatistics: true,
    config: { ...sample.config, channelA: 1 } });
  const design: IfExperimentalDesign = { kind: 'independent', confirmed: true, controlGroup: '对照组', aggregation: 'equal_sections', metric: 'pearsonMasked', regionMode: 'whole_image',
    assignments: records.map(([id, group, unitId, sectionId]) => ({ sampleId: id, sourceId: `sha256:${id}`, unitId, sectionId, fieldId: id, group, roiIds: [] })) };
  design.assignments.push({ ...design.assignments[0], sampleId: 'c1-duplicate' });
  project.ifSamples = samples;
  project.ifExperimentalDesign = design;
  return { project, result, design };
}

describe('canonical IF reports and exports', () => {
  it('prefers canonical measurements and keeps dedicated IF records separate from stain unit inference', () => {
    const { project, result, ifAnalysis, sample } = fixture();
    const report = buildFullReport(project, result, null, null);
    expect(report.colocalization).toEqual(ifAnalysis.overall);
    expect(report.colocalizationStatus).toBe('canonical');
    expect(report.ifAnalysis).toEqual(ifAnalysis);
    expect(report.ifAnalysis!.perRoi[0].pearsonAll).toBeNull();
    expect(report.ifSamples).toEqual([sample]);
    expect(report.ifInferenceStatus).toBe('descriptive_only');
    expect(report.samples).toEqual([]);
    expect(report.sampleStatistics.counts.nRecords).toBe(0);
    expect(Object.values(report.metrics).every((value) => value === null)).toBe(true);
  });

  it('exports actual ROI geometry, missing coefficients and per-record configurations without averaging regions', () => {
    const { project, result } = fixture();
    const book = buildWorkbook([], null, project, result);
    const current = table(book.Sheets['当前 IF']);
    const saved = table(book.Sheets['历史 IF']);
    expect(current).toHaveLength(2);
    expect(saved).toHaveLength(1);
    expect(current[0]).toMatchObject({ '测量区域': 'whole_image', '区域像素数': 12, '实际阈值 A': 11, '实际背景 A': 3, 'IF 阈值模式': 'auto', 'IF 背景百分位': 5 });
    expect(current[1]).toMatchObject({ 'ROI ID': 'roi-actual', '区域名称': '图中,区域甲', '区域 x (px)': 1, '区域 y (px)': 1, '区域宽度 (px)': 2, '区域高度 (px)': 1,
      '区域像素数': 2, '阳性并集像素数': 0, '全像素 Pearson': null, '掩膜 Pearson': null, 'Manders M1': null, 'Manders M2': null });
    expect(current[1]['未定义原因代码']).toContain('manders_m1_zero_denominator');
    expect(saved[0]).toMatchObject({ '记录 ID': 'saved-if', '样本': '历史样本', '来源 ID': 'sha256:historical', 'IF 阈值模式': 'manual', 'IF 背景百分位': 15, '实际阈值 A': 33, '实际背景 A': 9 });
    expect(book.SheetNames).not.toContain('统计检验');
    const csv = ifMetricsCsv(project, result);
    expect(csv).toContain('"图中,区域甲"');
    expect(csv).not.toContain('not-measured');
    const parsed = XLSX.read(csv, { type: 'string', raw: true });
    const rows = table(parsed.Sheets[parsed.SheetNames[0]]);
    expect(rows).toHaveLength(3);
    expect(rows[1]['Manders M1']).toBeNull();
    expect(rows[1]['区域像素数']).toBe('2');
  });

  it('describes fixed whole-image preprocessing and saved settings in both languages', () => {
    const { project, result } = fixture();
    const zh = generateMethodsZh(project, result);
    const en = generateMethodsEn(project, result);
    expect(zh).toContain('背景与阈值以整图为固定参考');
    expect(zh).toContain('整图及 1 个矩形 ROI');
    expect(zh).toContain('实际 A/B 阈值 11/22');
    expect(zh).toContain('实际 A/B 阈值 33/44');
    expect(en).toContain('without re-estimation within ROIs');
    expect(en).toContain('actual A/B thresholds 11/22');
    expect(en).toContain('actual A/B thresholds 33/44');
    expect(en).toContain('Saved IF record 历史样本');
    expect(en).toContain('15th percentile');
    expect(en).toContain('fixed v/257 scale, without per-image contrast stretching');
    expect(en).toContain('without IF group-inference p values');
    expect(en).not.toContain('199/188');
    expect(en).not.toContain('DAB');
  });

  it('uses one confirmed IF value per unit across API, CSV, workbook, Methods and diagnostics', () => {
    const { project, result, design } = studyFixture();
    const report = buildFullReport(project, result, null, null);
    expect(report.ifExperimentalDesign).toEqual(design);
    expect(report.ifInferenceStatus).toBe('available');
    expect(report.ifStatistics.counts).toMatchObject({ nRecords: 8, nIncludedRecords: 7, nExcludedRecords: 1, nBio: 4, nImages: 6, nFields: 6, nSections: 5, nRegions: 6 });
    expect(report.ifStatistics.aggregation.units.find((unit) => unit.unitId === 'c1')?.value).toBeCloseTo(0.5);
    expect(report.ifStatistics.aggregation.duplicateFieldGroups).toContainEqual(['c1-a', 'c1-duplicate']);
    expect(report.ifStatistics.report.ns).toEqual([2, 2]);
    expect(report.statistics.inferenceStatus).not.toBe('available');
    expect(report.diagnostics.issues.some((issue) => issue.message === 'IF 组间检验基于已确认的独立单位')).toBe(true);
    expect(report.methods.en).toContain('No Fisher transformation or pixel pooling');
    expect(report.methods.en).toContain('not evidence of adequate sample size or power');
    expect(report.methods.en).not.toContain('without IF group-inference p values');
    expect(report.methods.zh).toContain('单位内切片等权');
    const book = buildWorkbook([], null, project, result);
    expect(book.SheetNames).toEqual(expect.arrayContaining(['IF 实验设计', 'IF 视野与区域', 'IF 切片汇总', 'IF 实验单位', 'IF 分组描述', 'IF 统计检验']));
    expect(book.SheetNames).not.toContain('统计检验');
    expect(table(book.Sheets['IF 实验单位'])).toHaveLength(4);
    expect(table(book.Sheets['IF 视野与区域'])).toHaveLength(6);
    expect(table(book.Sheets['IF 切片汇总'])).toHaveLength(5);
    expect(table(book.Sheets['历史 IF']).find((row) => row['记录 ID'] === 'excluded')?.['排除于统计']).toBe('true');
    const csvBook = XLSX.read(ifUnitMetricsCsv(project), { type: 'string', raw: true });
    expect(table(csvBook.Sheets[csvBook.SheetNames[0]])).toHaveLength(4);
    expect(ifMetricsCsv(project)).toContain('重复记录');
    expect(ifMetricsCsv(project)).toContain('排除记录');
  });

  it('retains explicit selected ROI coefficients and arithmetic field means in trace exports', () => {
    const { project, result, design } = studyFixture();
    design.regionMode = 'equal_rois';
    design.assignments.forEach((assignment) => { assignment.roiIds = ['small', 'large']; });
    project.ifSamples = project.ifSamples!.map((sample) => ({ ...sample, analysis: { ...sample.analysis,
      perRoi: [
        { ...sample.analysis.overall, roiId: 'small', roiName: '小区域', rect: { x: 0, y: 0, w: 1, h: 1 }, pixelCount: 1, pearsonMasked: 0.1 },
        { ...sample.analysis.overall, roiId: 'large', roiName: '大区域', rect: { x: 2, y: 0, w: 2, h: 2 }, pixelCount: 4, pearsonMasked: 0.5 },
      ] } }));
    const stats = ifSampleStatistics(project.ifSamples, design);
    expect(stats.aggregation.designStatus).toBe('confirmed');
    expect(stats.aggregation.units[0].value).toBeCloseTo(0.3);
    expect(stats.counts.nRegions).toBe(12);
    const book = buildWorkbook([], null, project, result);
    const fields = table(book.Sheets['IF 视野与区域']);
    expect(fields).toHaveLength(12);
    expect(fields[0]).toMatchObject({ 'ROI ID': 'small', '区域系数': 0.1, '视野均值': 0.3, '选定区域数': 2 });
    expect(fields[1]).toMatchObject({ 'ROI ID': 'large', '区域系数': 0.5, '视野均值': 0.3 });
    expect(generateMethodsEn(project, result)).toContain('without area or pixel weighting');
    expect(generateMethodsZh(project, result)).toContain('系数的层级算术平均');
  });

  it('keeps missing units blank and blocks tests when a group has only one usable unit', () => {
    const { project, result } = studyFixture();
    const sample = project.ifSamples!.find((entry) => entry.id === 't2')!;
    sample.analysis = { ...sample.analysis, overall: { ...sample.analysis.overall, pearsonMasked: null } };
    const report = buildFullReport(project, result, null, null);
    expect(report.ifInferenceStatus).toBe('descriptive_only');
    expect(report.ifStatistics.counts.nBio).toBe(3);
    expect(report.ifStatistics.report.ns).toEqual([2, 1]);
    expect(report.ifStatistics.aggregation.units.find((unit) => unit.unitId === 't2')?.value).toBeNull();
    const book = buildWorkbook([], null, project, result);
    expect(book.SheetNames).not.toContain('IF 统计检验');
    expect(table(book.Sheets['IF 实验单位']).find((row) => row['实验单位 ID'] === 't2')).toMatchObject({ '单位均值': null, nBio: 0 });
    expect(report.methods.en).toContain('without IF group-inference p values');
    expect(report.methods.en).toContain('without zero substitution');
  });

  it('does not authorize IF inference through legacy reports or external stain statsSource', () => {
    const { project, result, design } = studyFixture();
    design.confirmed = false;
    const external = compareGroups([{ name: 'a', values: [1, 2, 3] }, { name: 'b', values: [4, 6, 8] }], { designStatus: 'confirmed', controlGroup: 'a' });
    const report = buildFullReport(project, result, null, { samples: [], metric: 'hScore', experimentalDesign: { kind: 'independent', confirmed: true, controlGroup: 'a', aggregation: 'equal_sections', assignments: [] } });
    expect(report.ifStatistics.aggregation.metric).toBe('pearsonMasked');
    expect(report.ifInferenceStatus).toBe('descriptive_only');
    expect(report.ifStatistics.counts.nBio).toBeNull();
    expect(report.ifStatistics.aggregation.units).toEqual([]);
    expect(buildWorkbook([], external, project, result).SheetNames).not.toContain('IF 统计检验');
    const diagnostic = evaluateDiagnostics({ project, result, qc: null, statsReport: external });
    expect(diagnostic.issues.some((issue) => issue.message === 'IF 当前仅提供描述统计')).toBe(true);
    expect(diagnostic.issues.some((issue) => issue.message === 'IF 组间检验基于已确认的独立单位')).toBe(false);
    expect(ifUnitMetricsCsv(project).trim().split('\n')).toHaveLength(1);
  });

  it('localizes IF statistics headers and issues while retaining user-defined names', () => {
    const { project, result } = studyFixture();
    project.ifSamples![0].config = { ...project.ifSamples![0].config, backgroundPercentile: 99 };
    setLanguage('en');
    const book = buildWorkbook([], null, project, result);
    expect(book.SheetNames).toContain('IF experimental design');
    expect(book.SheetNames).not.toContain('IF statistical tests');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['IF experimental design'], { header: 1 });
    const issue = rows.find((row) => row[0] === 'IF_CONFIGURATION_MIXED');
    expect(issue?.[1]).toContain('matching channels');
    expect(issue?.[1]).not.toMatch(/[\u4e00-\u9fff]/);
    const fields = table(book.Sheets['IF fields and regions']);
    expect(Object.keys(fields[0]).join('')).not.toMatch(/[\u4e00-\u9fff]/);
    expect(fields[0].Group).toBe('对照组');
    expect(generateMethodsEn(project, result)).toContain('matching channels');
    expect(ifUnitMetricsCsv(project).split('\n')[0]).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('labels legacy whole-image fallback without inventing ROI results, counts or configuration provenance', () => {
    const { project, result } = fixture();
    project.ifSamples = [];
    delete result.ifAnalysis;
    const report = ifReportData(project, result);
    expect(report.ifAnalysis).toBeNull();
    expect(report.colocalizationStatus).toBe('legacy_whole_image');
    expect(report.colocalization).toEqual(result.coloc);
    const book = buildWorkbook([], null, project, result);
    const rows = table(book.Sheets['当前 IF']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 'IF 结果格式': 'legacy_coloc', 'ROI ID': null, '区域像素数': null, 'IF 背景百分位': null, 'IF 阈值模式': null });
    expect(generateMethodsEn(project, result)).toContain('only a legacy whole-image IF result');
    expect(generateMethodsZh(project, result)).toContain('不能根据当前绘制的 ROI 补造历史测量');
  });

  it('limits the legacy-result restriction to that measurement when the saved IF study is eligible', () => {
    const { project, result } = studyFixture();
    delete result.ifAnalysis;
    expect(ifReportData(project, result).ifInferenceStatus).toBe('available');
    const methods = generateMethodsEn(project, result);
    expect(methods).toContain('This legacy measurement is descriptive only');
    expect(methods).toContain('IF group tests used unit means');
    expect(methods).not.toContain('Only descriptive measurements are provided, without group inference');
  });

  it('exports saved IF measurements while current analysis is unavailable or uses another stain profile', () => {
    const { project, sample } = fixture();
    project.profileId = 'h_dab';
    project.image = null;
    const report = ifReportData(project, null);
    expect(report.colocalizationStatus).toBe('unavailable');
    expect(report.ifSamples).toEqual([sample]);
    const book = buildWorkbook([], null, project, null);
    expect(book.SheetNames).not.toContain('当前 IF');
    expect(table(book.Sheets['历史 IF'])).toHaveLength(1);
    expect(generateMethodsEn(project, null)).toContain('actual A/B thresholds 33/44');
    expect(generateMethodsEn(project, null)).not.toContain('11/22');
  });

  it('localizes IF table headings and missing-value explanations without translating user identities', () => {
    const { project, result } = fixture();
    setLanguage('en');
    const book = buildWorkbook([], null, project, result);
    const current = table(book.Sheets['Current IF']);
    const saved = table(book.Sheets['Historical IF']);
    expect(Object.keys(current[0]).join(',')).not.toMatch(/[\u4e00-\u9fff]/);
    expect(current[1]['Region name']).toBe('图中,区域甲');
    expect(current[1]['Undefined-value reasons']).toContain('zero total channel A intensity');
    expect(saved[0]).toMatchObject({ Sample: '历史样本', Group: '对照组', Image: '历史图.tif' });
    expect(ifMetricsCsv(project, result).split('\n')[0]).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('retains per-record Methods across many IF records without exceeding Excel cell limits', () => {
    const { project, result, sample } = fixture();
    project.ifSamples = Array.from({ length: 25 }, (_, index) => ({ ...sample, id: `saved-${index}`, name: `历史样本${index}` }));
    expect(generateMethodsEn(project, result).length).toBeGreaterThan(32767);
    const book = buildWorkbook([], null, project, result);
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Methods, { header: 1 });
    expect(rows.every((row) => (row[0]?.length ?? 0) <= 30000)).toBe(true);
    expect(rows.some((row) => row[0]?.includes('Saved IF record 历史样本24'))).toBe(true);
    expect(() => XLSX.write(book, { bookType: 'xlsx', type: 'array' })).not.toThrow();
  });
});
