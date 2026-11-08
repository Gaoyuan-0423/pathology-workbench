import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { setLanguage } from '../i18n.ts';
import { buildFullReport, sampleStatistics } from './api.ts';
import { buildWorkbook, metricsCsv, unitMetricsCsv } from './export.ts';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { createEmptyProject, type AnalysisResult, type PathologyExperimentalDesign, type RoiMetrics, type SampleRecord } from './types.ts';

afterEach(() => setLanguage('zh'));

const baseMetrics: RoiMetrics = {
  roiId: null, roiName: 'Whole image', pixelCount: 100, positiveFraction: 0.1,
  positiveNuclei: 10, totalNuclei: 100, labelingIndex: 0.1, borderNuclei: 0,
  integratedOpticalDensity: 100, meanOpticalDensity: 1, estimatedTotalCount: 100,
  densityPerMm2: 100, hScore: 10,
};

function fixture() {
  const rows = [
    ['c1a', 'Control', 'c1', 's1', 'f1', 0.1],
    ['c1b', 'Control', 'c1', 's1', 'f2', 0.3],
    ['c1c', 'Control', 'c1', 's2', 'f1', 0.8],
    ['c2a', 'Control', 'c2', 's1', 'f1', 0.6],
    ['t1a', 'Treatment', 't1', 's1', 'f1', 0.8],
    ['t2a', 'Treatment', 't2', 's1', 'f1', 0.9],
  ] as const;
  const samples: SampleRecord[] = rows.map(([id, group, , , , value]) => ({
    id, name: id, group, imageName: `${id}.tif`, sourceId: `sha-${id}`, profileId: 'h_dab', addedAt: 0,
    metrics: { ...baseMetrics, positiveFraction: value, hScore: value * 100 },
  }));
  const design: PathologyExperimentalDesign = {
    kind: 'independent', confirmed: true, controlGroup: 'Control', aggregation: 'equal_sections',
    assignments: rows.map(([sampleId, group, unitId, sectionId, fieldId]) => ({ sampleId, group, unitId, sectionId, fieldId, sourceId: `sha-${sampleId}` })),
  };
  return { samples, design, project: { ...createEmptyProject(), samples, experimentalDesign: design } };
}

describe('sampleStatistics report and export boundary', () => {
  it('reports legacy images descriptively without biological n, tests or methods claims', () => {
    const { samples } = fixture();
    const stats = sampleStatistics(samples, 'positiveFraction');
    expect(stats.counts).toMatchObject({ nRecords: 6, nIncludedRecords: 6, nExcludedRecords: 0, nImages: 6, nBio: null, nSections: null });
    expect(stats.inference).toBe(false);
    expect(stats.report.omnibusParametric).toBeNull();
    expect(stats.report.pairwise).toEqual([]);
    const report = buildFullReport({ ...createEmptyProject(), samples }, null, null, null);
    expect(report.statistics.inferenceStatus).toBe('descriptive');
    expect(report.sampleStatistics.aggregation.measurementLevel).toBe('record');
    expect(report.samples[0]).toMatchObject({ id: 'c1a', sourceId: 'sha-c1a', profileId: 'h_dab' });
    expect(report.methods.en).toContain('Only descriptive statistics');
    expect(report.methods.en).not.toContain('Welch');
  });

  it('uses section-equal unit values consistently in API, workbook and Methods and collapses duplicate records', () => {
    const { samples, design, project } = fixture();
    samples.push({ ...samples[0], id: 'duplicate', name: 'Repeated save' });
    design.assignments.push({ ...design.assignments[0], sampleId: 'duplicate' });
    const stats = sampleStatistics(samples, 'positiveFraction', design);
    expect(stats.inference).toBe(true);
    expect(stats.aggregation.units[0].value).toBe(0.5);
    expect(stats.counts).toMatchObject({ nRecords: 7, nImages: 6, nBio: 4, nSections: 5, nFields: 6 });
    expect(stats.report.ns).toEqual([2, 2]);
    const report = buildFullReport(project, null, null, { samples, metric: 'hScore' });
    expect(report.sampleStatistics.aggregation.units[0].value).toBe(50);
    expect(report.methods.en).toContain('selected metric was H-score');
    expect(report.methods.en).toContain('Each unit contributed one value');
    expect(report.methods.zh).toContain('切片等权');
    expect(report.methods.en).not.toContain('Immunohistochemistry quantification was performed');
    const book = buildWorkbook(samples, null, project, null, 'hScore');
    expect(book.SheetNames).toContain('统计检验');
    const units = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['实验单位'], { header: 1 });
    expect(units[1].slice(0, 8)).toEqual(['c1', 'Control', 'H-score', 50, 1, 3, 2, 3]);
    const sections = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['切片汇总'], { header: 1 });
    expect(sections[1].slice(0, 6)).toEqual(['c1', 'Control', 's1', 'H-score', 20, 2]);
    expect(unitMetricsCsv(samples, design, 'hScore')).toContain('c1,Control,H-score,50,1,3,2,3');
  });

  it('does not let a supplied old inference report bypass design confirmation in Excel', () => {
    const { samples, design, project } = fixture();
    const oldReport = sampleStatistics(samples, 'positiveFraction', design).report;
    expect(oldReport.omnibusParametric).not.toBeNull();
    const book = buildWorkbook(samples, oldReport, { ...project, experimentalDesign: undefined }, null);
    expect(book.SheetNames).not.toContain('统计检验');
    const methods = XLSX.utils.sheet_to_csv(book.Sheets.Methods);
    expect(methods).toContain('Only descriptive statistics');
    expect(methods).not.toContain('Welch');
    expect(XLSX.utils.sheet_to_csv(book.Sheets['实验设计'])).toContain('unconfirmed');
  });

  it.each(['unknown-profile', 'mixed-profile', 'paired'] as const)('keeps %s designs descriptive across API and export', (kind) => {
    const { samples, project, design } = fixture();
    if (kind === 'unknown-profile') samples[0].profileId = undefined;
    if (kind === 'mixed-profile') samples[0].profileId = 'h_eosin';
    if (kind === 'paired') design.kind = 'paired';
    const report = buildFullReport(project, null, null, { samples, metric: 'positiveFraction' });
    expect(report.sampleStatistics.inference).toBe(false);
    expect(report.statistics.omnibusParametric).toBeNull();
    expect(report.statistics.pairwise).toEqual([]);
    expect(report.methods.en).toContain('Only descriptive statistics');
    expect(buildWorkbook(samples, null, project, null).SheetNames).not.toContain('统计检验');
  });

  it.each([false, true])('does not present IF compatibility placeholders as stain measurements (confirmed=%s)', (confirmed) => {
    const { samples, design, project } = fixture();
    design.confirmed = confirmed;
    for (const sample of samples) {
      sample.profileId = 'if_coloc';
      sample.metrics.positiveFraction = 0.73; // The IF engine stores Manders M1 here.
      sample.metrics.integratedOpticalDensity = 0;
    }
    const original = JSON.stringify(samples);
    for (const metric of ['positiveFraction', 'integratedOpticalDensity'] as const) {
      const stats = sampleStatistics(samples, metric, design);
      expect(stats.aggregation.groups.map((group) => group.values)).toEqual([[], []]);
      expect(stats.report.ns).toEqual([0, 0]);
      expect(stats.report.means.every(Number.isNaN)).toBe(true);
      expect(stats.inference).toBe(false);
      expect(stats.aggregation.issues.some((issue) => issue.code === 'IF_SAMPLE_METRIC_UNSUPPORTED')).toBe(true);
    }
    const api = buildFullReport(project, null, null, null);
    expect(api.samples[0]).toMatchObject({ '阳性面积': null, IOD: null, stainMetricsStatus: 'unsupported_if_colocalization' });
    expect(api.methods.en).toContain('Manders M1 and placeholders');
    expect(api.methods.zh).toContain('不参与这些指标的描述统计');
    const csv = metricsCsv(samples, design);
    expect(csv.split('\n')[1].split(',').slice(3, 10)).toEqual(['', '', '', '', '', '', '']);
    expect(csv).toContain('不支持：IF 共定位记录不提供染色指标。');
    const book = buildWorkbook(samples, null, project, null);
    const groupRows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['分组描述'], { header: 1, defval: null });
    expect(groupRows[1].slice(10, 14)).toEqual([0, null, null, null]);
    expect(JSON.stringify(samples)).toBe(original);
  });

  it('preserves actual current IF colocalization output while withholding stain labels', () => {
    const coloc: NonNullable<AnalysisResult['coloc']> = { channelA: 0, channelB: 1, pearsonAll: 0.4, pearsonMasked: 0.5, mandersM1: 0.73, mandersM2: 0.81, thresholdA: 10, thresholdB: 20, backgroundA: 0, backgroundB: 0 };
    const result: AnalysisResult = { requestId: 1, overall: { ...baseMetrics, positiveFraction: coloc.mandersM1, integratedOpticalDensity: 0 }, perRoi: [], thresholdUsed: 10, nuclearThresholdUsed: 20, backgroundLevel: 0, overlay: null, coloc, qc: null, aiUsed: false, aiModelLoaded: null, warnings: [] };
    const api = buildFullReport({ ...createEmptyProject(), profileId: 'if_coloc' }, result, null, null);
    expect(api.colocalization).toEqual(coloc);
    expect(Object.values(api.metrics).every((value) => value === null)).toBe(true);
    expect(api.parameters.stainMetricsStatus).toBe('unsupported_if_colocalization');
  });

  it('allows explicitly excluded IF records to remain in the raw library without affecting stain inference', () => {
    const { samples, design, project } = fixture();
    samples.push({ ...samples[0], id: 'if-excluded', profileId: 'if_coloc', excludedFromStatistics: true });
    const stats = sampleStatistics(samples, 'positiveFraction', design);
    expect(stats.inference).toBe(true);
    expect(stats.report.ns).toEqual([2, 2]);
    expect(stats.counts).toMatchObject({ nRecords: 7, nIncludedRecords: 6, nExcludedRecords: 1, nBio: 4 });
    const api = buildFullReport(project, null, null, null);
    expect(api.samples.at(-1)).toMatchObject({ excludedFromStatistics: true, '阳性面积': null, IOD: null });
  });

  it('preserves small nonzero p values as numbers in the Excel statistics sheet', () => {
    const { samples, design, project } = fixture();
    for (const sample of samples) sample.metrics.positiveFraction = sample.group === 'Control' ? 0.1 : 0.9;
    samples[3].metrics.positiveFraction = 0.100001;
    samples[5].metrics.positiveFraction = 0.900001;
    const expected = sampleStatistics(samples, 'positiveFraction', design).report.omnibusParametric!.p;
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(0.0001);
    const book = buildWorkbook(samples, null, project, null);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['统计检验'], { header: 1 });
    expect(rows[1][4]).toBe(expected);
  });

  it('keeps missing unit metrics empty and blocks inference when a group has fewer than two usable units', () => {
    const { samples, design, project } = fixture();
    samples[0].metrics.densityPerMm2 = null;
    const stats = sampleStatistics(samples, 'densityPerMm2', design);
    expect(stats.aggregation.units[0].value).toBeNull();
    expect(stats.groupCounts[0]).toMatchObject({ nBio: 1, nUnitsMapped: 2, nImages: 4 });
    expect(stats.inference).toBe(false);
    expect(stats.report.omnibusParametric).toBeNull();
    expect(unitMetricsCsv(samples, design, 'densityPerMm2')).toContain('c1,Control,密度 (个/mm²),,0,3,2,3');
    expect(generateMethodsZh(project, null, 'densityPerMm2')).toContain('不重新分配权重');
    expect(generateMethodsEn(project, null, 'densityPerMm2')).toContain('Only descriptive statistics');
  });

  it('separates all saved records from included images and preserves exclusions in exports', () => {
    const { samples, design } = fixture();
    samples.push({ ...samples[0], id: 'excluded', sourceId: undefined, excludedFromStatistics: true });
    const stats = sampleStatistics(samples, 'positiveFraction', design);
    expect(stats.counts).toMatchObject({ nRecords: 7, nIncludedRecords: 6, nExcludedRecords: 1, nImages: 6, nBio: 4 });
    expect(stats.groupCounts[0]).toMatchObject({ nRecords: 5, nIncludedRecords: 4, nExcludedRecords: 1 });
    expect(metricsCsv(samples, design).split('\n').at(-1)).toContain(',record,true');
  });

  it('retains numeric precision and quotes CSV record identities with CR and commas', () => {
    const { samples, design } = fixture();
    samples[0].name = 'alpha\rbeta,gamma';
    samples[0].metrics.positiveFraction = 0.00000001234567;
    const csv = metricsCsv(samples, design);
    expect(csv).toContain('"alpha\rbeta,gamma"');
    expect(csv).toContain('1.234567e-8');
    expect(csv).toContain(',c1a,sha-c1a,h_dab,c1,s1,f1,confirmed,record,false');
  });
});
