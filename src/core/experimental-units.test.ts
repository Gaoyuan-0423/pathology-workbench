import { describe, expect, it } from 'vitest';
import { aggregateExperimentalUnits } from './experimental-units.ts';
import { compareGroups } from './analysis/statistics.ts';
import type { PathologyExperimentalDesign, RoiMetrics, SampleRecord } from './types.ts';

function metric(value: number | null): RoiMetrics {
  return { roiId: null, roiName: 'whole image', pixelCount: 1000, positiveFraction: value ?? NaN,
    positiveNuclei: 0, totalNuclei: 0, labelingIndex: null, integratedOpticalDensity: 0,
    meanOpticalDensity: null, borderNuclei: 0, estimatedTotalCount: null, densityPerMm2: null, hScore: value };
}
function setup(plan: Array<[string, string, string, number | null]> = [
  ['C1', 'Control', 'S1', 10], ['C1', 'Control', 'S1', 20], ['C1', 'Control', 'S1', 30],
  ['C1', 'Control', 'S2', 90], ['C2', 'Control', 'S1', 50],
  ['T1', 'Treatment', 'S1', 75], ['T2', 'Treatment', 'S1', 80],
]) {
  const samples: SampleRecord[] = [];
  const design: PathologyExperimentalDesign = { kind: 'independent', confirmed: true,
    controlGroup: 'Control', aggregation: 'equal_sections', assignments: [] };
  plan.forEach(([unitId, group, sectionId, value], index) => {
    const id = `record-${index}`;
    const sourceId = `source-${index}`;
    samples.push({ id, sourceId, profileId: 'h_dab', name: `same display name`, imageName: `same-file-name.png`, group, addedAt: index, metrics: metric(value) });
    design.assignments.push({ sampleId: id, sourceId, unitId, group, sectionId, fieldId: `field-${index}` });
  });
  return { samples, design };
}
const aggregate = (samples: SampleRecord[], design?: PathologyExperimentalDesign) => aggregateExperimentalUnits(samples, 'hScore', design);

describe('pathology biological-unit aggregation', () => {
  it('legacy records remain descriptive and never imply independence from image names', () => {
    const { samples } = setup();
    for (const sample of samples) { delete sample.sourceId; delete sample.profileId; }
    const result = aggregate(samples);
    expect(result.designStatus).toBe('unconfirmed');
    expect(result.measurementLevel).toBe('record');
    expect(result.units).toEqual([]);
    expect(result.groups.find((g) => g.name === 'Control')!.values).toEqual([10, 20, 30, 90, 50]);
    const report = compareGroups(result.groups);
    expect(report.omnibusParametric).toBeNull();
    expect(report.omnibusNonParametric).toBeNull();
  });

  it('averages fields within sections, then sections equally within biological units', () => {
    const { samples, design } = setup();
    const result = aggregate(samples, design);
    expect(result.designStatus).toBe('confirmed');
    expect(result.measurementLevel).toBe('biological_unit');
    const c1 = result.units.find((unit) => unit.unitId === 'C1')!;
    expect(c1.nFields).toBe(4);
    expect(c1.nSections).toBe(2);
    expect(c1.sections.map((section) => section.value)).toEqual([20, 90]);
    expect(c1.value).toBe(55); // (20+90)/2, not the field-weighted 37.5.
    expect(result.groups.find((g) => g.name === 'Control')!.values).toEqual([55, 50]);
    expect(result.units).toHaveLength(4);
  });

  it('duplicate records of the same field do not change n, field weights or unit values', () => {
    const { samples, design } = setup();
    const before = aggregate(samples, design);
    samples.push({ ...samples[0], id: 'copied-record' });
    design.assignments.push({ ...design.assignments[0], sampleId: 'copied-record' });
    const after = aggregate(samples, design);
    expect(after.designStatus).toBe('confirmed');
    expect(after.groups).toEqual(before.groups);
    expect(after.units.find((u) => u.unitId === 'C1')!.nFields).toBe(4);
    expect(after.duplicateFieldGroups).toEqual([['record-0', 'copied-record']]);
    expect(after.issues.some((i) => i.code === 'DUPLICATE_FIELDS_COLLAPSED')).toBe(true);
  });

  it('one unit with three fields remains n=1 and cannot receive a biological p value', () => {
    const { samples, design } = setup([
      ['C1', 'Control', 'S1', 10], ['C1', 'Control', 'S1', 20], ['C1', 'Control', 'S1', 30],
      ['T1', 'Treatment', 'S1', 70], ['T1', 'Treatment', 'S1', 80], ['T1', 'Treatment', 'S1', 90],
    ]);
    const result = aggregate(samples, design);
    const report = compareGroups(result.groups, { designStatus: result.designStatus, controlGroup: design.controlGroup });
    expect(report.ns).toEqual([1, 1]);
    expect(report.inferenceStatus).toBe('blocked');
    expect(report.pairwise).toEqual([]);
    expect(report.omnibusParametric).toBeNull();
  });

  it('three declared units with three fields each contribute three group values', () => {
    const plan: Array<[string, string, string, number]> = [];
    for (const group of ['Control', 'Treatment']) for (let u = 0; u < 3; u++) for (let f = 0; f < 3; f++) {
      plan.push([`${group}-${u}`, group, 'S1', 10 + u + f + (group === 'Treatment' ? 20 : 0)]);
    }
    const { samples, design } = setup(plan);
    const result = aggregate(samples, design);
    expect(result.groups.map((g) => g.values.length)).toEqual([3, 3]);
    expect(result.units.every((u) => u.nFields === 3)).toBe(true);
  });

  it.each(['unitId', 'sectionId', 'fieldId'] as const)('the same source cannot be relabeled as another %s', (field) => {
    const { samples, design } = setup();
    samples.push({ ...samples[0], id: 'copy' });
    design.assignments.push({ ...design.assignments[0], sampleId: 'copy', [field]: 'different' });
    const result = aggregate(samples, design);
    expect(result.designStatus).toBe('invalid');
    expect(result.issues.some((i) => i.code === 'SOURCE_FIELD_CONFLICT')).toBe(true);
  });

  it('conflicting measurements of one field are blocked instead of selecting or averaging versions', () => {
    const { samples, design } = setup();
    samples.push({ ...samples[0], id: 'reanalysis', metrics: metric(99) });
    design.assignments.push({ ...design.assignments[0], sampleId: 'reanalysis' });
    expect(aggregate(samples, design).issues.some((i) => i.code === 'DUPLICATE_FIELD_VALUE_CONFLICT')).toBe(true);
    samples[samples.length - 1].excludedFromStatistics = true;
    const excluded = aggregate(samples, design);
    expect(excluded.designStatus).toBe('confirmed');
    expect(excluded.excludedSampleIds).toEqual(['reanalysis']);
    expect(excluded.includedSampleIds).not.toContain('reanalysis');
    expect(excluded.units.find((u) => u.unitId === 'C1')!.value).toBe(55);
    expect(samples).toHaveLength(8); // Historical record remains intact.
  });

  it('unknown or mixed profiles block inference; explicit exclusion can remove unrelated records', () => {
    const { samples, design } = setup();
    delete samples[0].profileId;
    expect(aggregate(samples, design).issues.some((i) => i.code === 'PROFILE_UNKNOWN')).toBe(true);
    samples[0].profileId = 'h_dab';
    samples.push({ ...samples[0], id: 'other-profile', profileId: 'if_coloc' });
    design.assignments.push({ ...design.assignments[0], sampleId: 'other-profile' });
    expect(aggregate(samples, design).issues.some((i) => i.code === 'PROFILE_MIXED')).toBe(true);
    samples[samples.length - 1].excludedFromStatistics = true;
    design.assignments.pop(); // Excluded records do not require assignments.
    expect(aggregate(samples, design).designStatus).toBe('confirmed');
  });

  it('known source hashes are immutable in the assignment, while explicit legacy source declarations are allowed', () => {
    const { samples, design } = setup();
    design.assignments[0].sourceId = 'declared-source';
    expect(aggregate(samples, design).issues.some((i) => i.code === 'SOURCE_ID_CONFLICT')).toBe(true);
    delete samples[0].sourceId;
    expect(aggregate(samples, design).designStatus).toBe('confirmed');
    design.assignments[0].sourceId = 'unknown';
    expect(aggregate(samples, design).designStatus).toBe('invalid');
  });

  it('IF colocalization placeholder metrics cannot be authorized for sample-library inference through the API', () => {
    const { samples, design } = setup();
    for (const sample of samples) sample.profileId = 'if_coloc';
    const result = aggregate(samples, design);
    expect(result.designStatus).toBe('invalid');
    expect(result.measurementLevel).toBe('record');
    expect(result.units).toEqual([]);
    expect(result.issues.some((issue) => issue.code === 'IF_SAMPLE_METRIC_UNSUPPORTED')).toBe(true);
    expect(samples).toHaveLength(7);
  });

  it('ROI metrics cannot use whole-image source identity to enter unit inference', () => {
    const { samples, design } = setup();
    samples[0].metrics.roiId = 'roi-1';
    const result = aggregate(samples, design);
    expect(result.designStatus).toBe('invalid');
    expect(result.measurementLevel).toBe('record');
    expect(result.units).toEqual([]);
    expect(result.issues.find((issue) => issue.code === 'MEASUREMENT_SCOPE_UNSUPPORTED')?.sampleIds).toEqual(['record-0']);
    expect(result.groups.find((group) => group.name === 'Control')?.values).toEqual([10, 20, 30, 90, 50]);
    expect(samples[0].metrics.roiId).toBe('roi-1');
  });

  it('missing metric nullifies its whole unit rather than changing the declared field or section weights', () => {
    const { samples, design } = setup();
    samples[0].metrics.hScore = null;
    const result = aggregate(samples, design);
    const c1 = result.units.find((u) => u.unitId === 'C1')!;
    expect(c1.value).toBeNull();
    expect(c1.nFields).toBe(4);
    expect(c1.nSections).toBe(2);
    expect(result.groups.find((g) => g.name === 'Control')!.values).toEqual([50]);
    expect(result.issues.some((i) => i.code === 'FIELD_METRIC_MISSING')).toBe(true);
    for (const sample of samples) if (sample.group === 'Control') sample.metrics.hScore = null;
    const emptyControl = aggregate(samples, design);
    expect(emptyControl.groups.find((g) => g.name === 'Control')!.values).toEqual([]);
    const report = compareGroups(emptyControl.groups, { designStatus: emptyControl.designStatus, controlGroup: design.controlGroup });
    expect(report.groupNames).toContain('Control');
    expect(report.ns).toEqual([0, 2]);
    expect(report.omnibusParametric).toBeNull();
  });

  it.each(['paired', 'repeated'] as const)('%s designs explicitly remain unsupported', (kind) => {
    const { samples, design } = setup();
    design.kind = kind;
    design.confirmed = false;
    const result = aggregate(samples, design);
    expect(result.designStatus).toBe('unsupported');
    expect(result.units).toEqual([]);
  });

  it('missing mappings, conflicting groups, stale records and unsupported weighting block inference', () => {
    const missing = setup(); missing.design.assignments.pop();
    expect(aggregate(missing.samples, missing.design).issues.some((i) => i.code === 'ASSIGNMENT_MISSING')).toBe(true);
    const conflict = setup(); conflict.design.assignments[0].group = 'Treatment';
    expect(aggregate(conflict.samples, conflict.design).issues.some((i) => i.code === 'GROUP_CONFLICT')).toBe(true);
    const stale = setup(); stale.design.assignments.push({ ...stale.design.assignments[0], sampleId: 'gone' });
    expect(aggregate(stale.samples, stale.design).issues.some((i) => i.code === 'ASSIGNMENT_STALE')).toBe(true);
    const weighting = setup(); weighting.design.aggregation = 'equal_fields' as 'equal_sections';
    expect(aggregate(weighting.samples, weighting.design).issues.some((i) => i.code === 'AGGREGATION_UNSUPPORTED')).toBe(true);
  });
});
