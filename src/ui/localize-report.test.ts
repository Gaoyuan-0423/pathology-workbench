import { afterEach, expect, it } from 'vitest';
import { buildFullReport } from '../core/api.ts';
import { createEmptyProject, type RoiMetrics, type SampleRecord } from '../core/types.ts';
import { setLanguage } from '../i18n.ts';
import { localizeReport } from './localize-report.ts';
import { analyzeColocImage } from '../core/analysis/engine.ts';

afterEach(() => setLanguage('zh'));

it('localizes nested IF validation and test messages without changing user identities or machine values', () => {
  const project = createEmptyProject(); project.profileId = 'if_coloc';
  const pixels = { width: 2, height: 2, data: Uint8ClampedArray.from([10,20,0,255,20,40,0,255,30,60,0,255,40,80,0,255]) };
  const analysis = analyzeColocImage(pixels, project.coloc).ifAnalysis;
  project.ifSamples = ['对照组', '处理组'].map((group, i) => ({ id: `记录${i}`, name: '中文记录', group, sourceId: `来源${i}`, imageName: '中文原图.png',
    profileId: 'if_coloc', addedAt: 0, config: { ...project.coloc, backgroundPercentile: i ? 99 : project.coloc.backgroundPercentile }, analysis,
    image: { name: '中文原图.png', sourceType: 'PNG', sourceWidth: 2, sourceHeight: 2, workingWidth: 2, workingHeight: 2, workingScale: 1, bitsPerSample: 8 } }));
  project.ifExperimentalDesign = { kind: 'independent', confirmed: true, controlGroup: '对照组', aggregation: 'equal_sections', metric: 'pearsonMasked', regionMode: 'whole_image',
    assignments: project.ifSamples.map((s, i) => ({ sampleId: s.id, sourceId: s.sourceId, unitId: `单位${i}`, sectionId: '切片', fieldId: '视野', group: s.group, roiIds: [] })) };
  const report = buildFullReport(project, null, null, null);
  setLanguage('en');
  const localized = localizeReport(report);
  expect(localized.ifStatistics.aggregation.issues.find((i) => i.code === 'IF_CONFIGURATION_MIXED')?.message).toContain('matching channels');
  expect(localized.ifStatistics.report?.recommendation).not.toMatch(/[\u4e00-\u9fff]/);
  expect(localized.ifStatistics.report?.issues.map((i) => i.message).join(' ')).not.toMatch(/[\u4e00-\u9fff]/);
  expect(localized.ifSamples).toEqual(report.ifSamples);
  expect(localized.ifExperimentalDesign).toEqual(report.ifExperimentalDesign);
  expect(localized.ifStatistics.aggregation.metric).toBe('pearsonMasked');
  expect(localized.ifStatistics.aggregation.groups.map((g) => g.name)).toEqual(['对照组', '处理组']);
});

it('localizes nested statistical issues while preserving Chinese user identities and machine codes', () => {
  const metrics: RoiMetrics = { roiId: null, roiName: '整图', pixelCount: 10, positiveFraction: 0.2, positiveNuclei: 2,
    totalNuclei: 10, labelingIndex: 0.2, integratedOpticalDensity: 20, meanOpticalDensity: 2, borderNuclei: 0,
    estimatedTotalCount: 10, densityPerMm2: null, hScore: 20 };
  const samples: SampleRecord[] = ['对照组', '处理组'].map((group, index) => ({ id: `记录${index}`, name: '阳性面积', group,
    sourceId: `来源${index}`, profileId: 'h_dab', imageName: '中文原图.tif', addedAt: 0, metrics: { ...metrics, densityPerMm2: index ? 10 : null } }));
  const report = buildFullReport({ ...createEmptyProject(), samples, experimentalDesign: {
    kind: 'independent', confirmed: true, controlGroup: '对照组', aggregation: 'equal_sections',
    assignments: samples.map((sample, index) => ({ sampleId: sample.id, sourceId: sample.sourceId!, group: sample.group,
      unitId: `单位${index}`, sectionId: '切片甲', fieldId: '视野甲' })),
  } }, null, null, { samples, metric: 'densityPerMm2' });
  setLanguage('en');
  const localized = localizeReport(report);
  expect(localized.sampleStatistics.aggregation.issues[0]).toMatchObject({ code: 'FIELD_METRIC_MISSING', sampleIds: ['记录0'] });
  expect(localized.sampleStatistics.aggregation.issues[0].message).toContain('Unit 单位0 has a declared field without a valid metric');
  expect(localized.statistics!.issues[0].message).toContain('At least two groups are required');
  expect(localized.sampleStatistics.report!.issues[0].message).toBe(localized.statistics!.issues[0].message);
  expect(localized.sampleStatistics.report!.recommendation).toBe(localized.statistics!.recommendation);
  expect(localized.statistics!.issues[0].code).toBe('INSUFFICIENT_BIOLOGICAL_REPLICATION');
  expect(localized.samples[0]).toMatchObject({ name: '阳性面积', group: '对照组', sourceId: '来源0', imageName: '中文原图.tif' });
  expect(localized.sampleStatistics.aggregation.groups.map(group => group.name)).toEqual(['对照组', '处理组']);
  expect(localized.experimentalDesign).toEqual(report.experimentalDesign);
  expect(report.sampleStatistics.aggregation.issues[0].message).toContain('单位 单位0');
});
