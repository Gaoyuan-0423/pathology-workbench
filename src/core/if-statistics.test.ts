import { describe, expect, it } from 'vitest';
import { createDefaultIfExperimentalDesign, ifSampleStatistics, type IfExperimentalDesign } from './if-statistics.ts';
import type { ColocConfig, IfRegionResult, IfSampleRecord } from './types.ts';

// Explicit synthetic coefficient records. These are tests of the declared
// aggregation contract, not coefficients claimed to come from real images.
const config: ColocConfig = { channelA: 0, channelB: 1, backgroundPercentile: 5, thresholdMode: 'auto', manualA: 20, manualB: 30 };
function region(value: number | null, id: string | null = null, rect = { x: 0, y: 0, w: 100, h: 100 }): IfRegionResult {
  return { roiId: id, roiName: id ?? 'whole', rect, pixelCount: rect.w * rect.h,
    positivePixelsA: 10, positivePixelsB: 10, unionPixels: 15, intersectionPixels: 5,
    channelA: 0, channelB: 1, backgroundA: 2, backgroundB: 3, thresholdA: 20, thresholdB: 30,
    pearsonAll: value, pearsonMasked: value, mandersM1: value, mandersM2: value,
    sumA: 100, sumB: 100, sumAInBPositive: value === null ? 0 : 100 * value, sumBInAPositive: value === null ? 0 : 100 * value,
    undefinedReasons: value === null ? ['pearson_masked_zero_variance'] : [] };
}
type PlanRow = [unit: string, group: string, section: string, value: number | null];
function fixture(plan?: PlanRow[]) {
  const rows: PlanRow[] = plan ?? ['Control', 'Treatment'].flatMap((group) => Array.from({ length: 3 }, (_, u) =>
    Array.from({ length: 5 }, (_, f): PlanRow => [`${group}-${u}`, group, 's1', (group === 'Control' ? 0.1 : 0.5) + 0.05 * u + 0.01 * f])).flat());
  const design: IfExperimentalDesign = { ...createDefaultIfExperimentalDesign(), confirmed: true, controlGroup: 'Control' };
  const samples: IfSampleRecord[] = rows.map(([unitId, group, sectionId, value], i) => {
    const id = `record-${i}`, sourceId = `synthetic:${i}`;
    design.assignments.push({ sampleId: id, sourceId, unitId, group, sectionId, fieldId: `field-${i}`, roiIds: [] });
    return { id, sourceId, profileId: 'if_coloc', name: 'same display name', imageName: 'same.png', group, addedAt: i,
      image: { name: 'same.png', sourceWidth: 100, sourceHeight: 100, workingWidth: 100, workingHeight: 100, workingScale: 1, bitsPerSample: 8, sourceType: 'PNG' },
      config: { ...config }, analysis: { schemaVersion: 'wisplab.if-colocalization/v1', normalizationScope: 'whole_image',
        imageWidth: 100, imageHeight: 100, overall: region(value), perRoi: [] } };
  });
  return { samples, design };
}
function withRois() {
  const setup = fixture(); setup.design.regionMode = 'equal_rois';
  setup.samples.forEach((sample, index) => {
    const value = sample.analysis.overall.pearsonMasked!;
    sample.analysis.perRoi = [region(value - 0.05, 'a', { x: 0, y: 0, w: 10, h: 10 }), region(value + 0.05, 'b', { x: 10, y: 0, w: 30, h: 10 })];
    setup.design.assignments[index].roiIds = ['a', 'b'];
  });
  return setup;
}
const codes = (result: ReturnType<typeof ifSampleStatistics>) => result.aggregation.issues.map((issue) => issue.code);
function duplicate(setup: ReturnType<typeof fixture>) {
  const copy = structuredClone(setup.samples[0]); copy.id = 'duplicate';
  setup.samples.push(copy); setup.design.assignments.push({ ...setup.design.assignments[0], sampleId: copy.id, roiIds: [...setup.design.assignments[0].roiIds] });
  return copy;
}
function patchActual(sample: IfSampleRecord, patch: Partial<IfRegionResult>) {
  Object.assign(sample.analysis.overall, patch);
  sample.analysis.perRoi.forEach((roi) => Object.assign(roi, patch));
}

describe('IF declared units and arithmetic region summaries', () => {
  it('defaults to unconfirmed masked Pearson on whole images and never derives independence from names', () => {
    const { samples } = fixture(); samples[0].analysis.overall.pearsonMasked = 0;
    const result = ifSampleStatistics(samples);
    expect(result.aggregation).toMatchObject({ metric: 'pearsonMasked', regionMode: 'whole_image', designStatus: 'unconfirmed', measurementLevel: 'record', units: [] });
    expect(result.aggregation.fields).toHaveLength(30);
    expect(result.aggregation.fields[0].value).toBe(0);
    expect(result.counts).toMatchObject({ nRecords: 30, nImages: 30, nBio: null, nFields: null, nRegions: null });
    expect(result.inference).toBe(false); expect(result.report.omnibusParametric).toBeNull();
  });

  it('three units with five fields each produce nBio=3, nImages=15 and nRegions=15 per group', () => {
    const { samples, design } = fixture(); const result = ifSampleStatistics(samples, design);
    expect(result.aggregation.designStatus).toBe('confirmed'); expect(result.inference).toBe(true);
    expect(result.report.ns).toEqual([3, 3]); expect(result.report.omnibusParametric?.label).toContain('Welch');
    expect(result.groupCounts).toEqual(['Control', 'Treatment'].map((group) => ({ group,
      nRecords: 15, nIncludedRecords: 15, nExcludedRecords: 0, nImages: 15, nBio: 3, nUnitsMapped: 3, nSections: 3, nFields: 15, nRegions: 15 })));
    result.aggregation.groups[0].values.forEach((value, index) => expect(value).toBeCloseTo([0.12, 0.17, 0.22][index], 14));
  });

  it('keeps each section equally weighted when field counts differ', () => {
    const { samples, design } = fixture([
      ['C1', 'Control', 's1', 0.1], ['C1', 'Control', 's1', 0.2], ['C1', 'Control', 's1', 0.3], ['C1', 'Control', 's2', 0.9],
      ['C2', 'Control', 's1', 0.6], ['T1', 'Treatment', 's1', 0.3], ['T2', 'Treatment', 's1', 0.4],
    ]);
    const unit = ifSampleStatistics(samples, design).aggregation.units[0];
    expect(unit.value).toBeCloseTo(0.55, 14); expect(unit.value).not.toBeCloseTo(0.375);
    expect(unit.sections.map((section) => section.nRegions)).toEqual([3, 1]);
  });

  it('averages ROI coefficients equally into one field, without pixel weighting or increasing nBio', () => {
    const { samples, design } = withRois(); const result = ifSampleStatistics(samples, design);
    expect(result.aggregation.fields[0].value).toBeCloseTo(0.1, 14); // unequal areas 100 and 300 pixels
    expect(result.aggregation.fields[0].regions.map((item) => item.value)).toEqual([0.05, 0.15000000000000002]);
    expect(result.groupCounts[0]).toMatchObject({ nRegions: 30, nFields: 15, nImages: 15, nBio: 3 });
    expect(result.report.ns).toEqual([3, 3]);
  });

  it('deduplicates equivalent source/field geometry despite changed ROI IDs, names and selection order', () => {
    const setup = withRois(); const before = ifSampleStatistics(setup.samples, setup.design);
    const copy = duplicate(setup); copy.name = 'renamed';
    copy.analysis.perRoi[0].roiId = 'renamed-a'; copy.analysis.perRoi[0].roiName = 'another name';
    copy.analysis.perRoi[1].roiId = 'renamed-b';
    setup.design.assignments.at(-1)!.roiIds = ['renamed-b', 'renamed-a'];
    const after = ifSampleStatistics(setup.samples, setup.design);
    expect(after.aggregation.designStatus).toBe('confirmed'); expect(after.aggregation.groups).toEqual(before.aggregation.groups);
    expect(after.report.ns).toEqual(before.report.ns); expect(after.report.omnibusParametric).toEqual(before.report.omnibusParametric);
    expect(after.counts).toMatchObject({ nRecords: 31, nImages: 30, nFields: 30, nRegions: 60, nBio: 6 });
    expect(after.aggregation.fields[0].sampleIds).toEqual(['record-0', 'duplicate']);
    expect(after.aggregation.duplicateFieldGroups).toEqual([['record-0', 'duplicate']]);
  });

  it('propagates one missing selected ROI through the field, section and entire unit without reweighting', () => {
    const { samples, design } = withRois(); samples[0].analysis.perRoi[0].pearsonMasked = null;
    const result = ifSampleStatistics(samples, design);
    expect(result.aggregation.designStatus).toBe('confirmed');
    expect(result.aggregation.fields[0].value).toBeNull(); expect(result.aggregation.units[0].sections[0].value).toBeNull();
    expect(result.aggregation.units[0].value).toBeNull();
    expect(result.groupCounts[0]).toMatchObject({ nBio: 2, nFields: 15, nRegions: 30 });
    expect(result.report.ns).toEqual([2, 3]); expect(codes(result)).toContain('FIELD_METRIC_MISSING');
    samples.filter((sample) => sample.group === 'Control').forEach((sample) => { sample.analysis.perRoi[0].pearsonMasked = null; });
    const missing = ifSampleStatistics(samples, design);
    expect(missing.aggregation.groups[0]).toEqual({ name: 'Control', values: [] });
    expect(missing.report.groupNames).toEqual(['Control', 'Treatment']); expect(missing.report.ns).toEqual([0, 3]);
    expect(missing.report.inferenceStatus).toBe('blocked'); expect(missing.report.omnibusParametric).toBeNull();
  });

  it('retains valid zero coefficients, including zero Manders, as measurements', () => {
    const { samples, design } = fixture(); design.metric = 'mandersM1';
    samples.filter((sample) => sample.group === 'Control').forEach((sample) => { sample.analysis.overall.mandersM1 = 0; });
    const result = ifSampleStatistics(samples, design);
    expect(result.aggregation.groups[0].values).toEqual([0, 0, 0]); expect(result.groupCounts[0].nBio).toBe(3);
  });

  it.each(['paired', 'repeated'] as const)('explicitly refuses %s designs even before confirmation', (kind) => {
    const { samples, design } = fixture(); design.kind = kind; design.confirmed = false;
    const result = ifSampleStatistics(samples, design);
    expect(result.aggregation.designStatus).toBe('unsupported'); expect(result.inference).toBe(false);
    expect(result.counts.nBio).toBeNull(); expect(result.report.omnibusParametric).toBeNull();
  });

  it('one unit per group with five fields still cannot produce a biological p value', () => {
    const setup = fixture(); setup.samples = setup.samples.filter((sample) => setup.design.assignments.find((a) => a.sampleId === sample.id)!.unitId.endsWith('-0'));
    setup.design.assignments = setup.design.assignments.filter((a) => setup.samples.some((sample) => sample.id === a.sampleId));
    const result = ifSampleStatistics(setup.samples, setup.design);
    expect(result.report.ns).toEqual([1, 1]); expect(result.report.inferenceStatus).toBe('blocked');
    expect(result.report.omnibusParametric).toBeNull(); expect(result.report.pairwise).toEqual([]);
  });
});

describe('IF selection, source and configuration guards', () => {
  it.each(['unitId', 'sectionId', 'fieldId'] as const)('refuses one source relabeled into another %s', (key) => {
    const setup = fixture(); duplicate(setup); setup.design.assignments.at(-1)![key] = 'different';
    const result = ifSampleStatistics(setup.samples, setup.design);
    expect(result.aggregation.designStatus).toBe('invalid'); expect(codes(result)).toContain('SOURCE_FIELD_CONFLICT');
  });

  it('cannot override a known source; unknown requires an explicit declared mapping', () => {
    const { samples, design } = fixture(); design.assignments[0].sourceId = 'declared:legacy';
    expect(codes(ifSampleStatistics(samples, design))).toContain('SOURCE_ID_CONFLICT');
    samples[0].sourceId = 'unknown'; expect(ifSampleStatistics(samples, design).aggregation.designStatus).toBe('confirmed');
    design.assignments[0].sourceId = 'unknown'; expect(ifSampleStatistics(samples, design).aggregation.designStatus).toBe('invalid');
  });

  it('blocks group, unit-across-group, missing assignment and stale assignment conflicts', () => {
    const conflict = fixture(); conflict.design.assignments[0].group = 'Treatment';
    expect(codes(ifSampleStatistics(conflict.samples, conflict.design))).toContain('GROUP_CONFLICT');
    const spanning = fixture(); spanning.design.assignments[15].unitId = spanning.design.assignments[0].unitId;
    expect(codes(ifSampleStatistics(spanning.samples, spanning.design))).toContain('UNIT_GROUP_CONFLICT');
    const missing = fixture(); missing.design.assignments.pop();
    expect(codes(ifSampleStatistics(missing.samples, missing.design))).toContain('ASSIGNMENT_MISSING');
    const stale = fixture(); stale.design.assignments.push({ ...stale.design.assignments[0], sampleId: 'gone' });
    expect(codes(ifSampleStatistics(stale.samples, stale.design))).toContain('ASSIGNMENT_STALE');
  });

  it('requires an explicit control and does not silently replace an invalid metric or mode for inference', () => {
    const setup = fixture(); setup.design.controlGroup = '';
    expect(ifSampleStatistics(setup.samples, setup.design).aggregation.designStatus).toBe('invalid');
    setup.design.controlGroup = 'missing'; expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('CONTROL_GROUP_NOT_FOUND');
    setup.design.controlGroup = 'Control'; setup.design.metric = 'hScore' as any;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_METRIC_UNSUPPORTED');
    setup.design.metric = 'pearsonMasked'; setup.design.regionMode = 'pixels_pooled' as any;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_REGION_MODE_UNSUPPORTED');
  });

  it.each(['channelA', 'channelB', 'backgroundPercentile', 'thresholdMode'] as const)('blocks mixed %s configurations', (key) => {
    const { samples, design } = fixture(); Object.assign(samples[0].config, { [key]: key === 'thresholdMode' ? 'manual' : 2 });
    expect(codes(ifSampleStatistics(samples, design))).toContain('IF_CONFIGURATION_MIXED');
  });

  it('allows image-specific auto thresholds/backgrounds but compares effective manual thresholds', () => {
    const setup = withRois(); patchActual(setup.samples[0], { thresholdA: 100, backgroundA: 4 });
    expect(ifSampleStatistics(setup.samples, setup.design).aggregation.designStatus).toBe('confirmed');
    for (const sample of setup.samples) { sample.config.thresholdMode = 'manual'; sample.config.manualA = 20.1; }
    patchActual(setup.samples[0], { thresholdA: 20 }); setup.samples[0].config.manualA = 20.4;
    expect(ifSampleStatistics(setup.samples, setup.design).aggregation.designStatus).toBe('confirmed');
    setup.samples[0].config.manualA = 21;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_CONFIGURATION_MIXED');
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_RESULT_CONFIGURATION_CONFLICT');
  });

  it('compares duplicate source actual preprocessing and each selected value, not just their mean', () => {
    const setup = withRois(); const copy = duplicate(setup);
    copy.analysis.perRoi[0].pearsonMasked! += 0.02; copy.analysis.perRoi[1].pearsonMasked! -= 0.02;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('DUPLICATE_FIELD_SELECTION_CONFLICT');
    copy.analysis.perRoi = structuredClone(setup.samples[0].analysis.perRoi); patchActual(copy, { thresholdA: 99 });
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('DUPLICATE_FIELD_SELECTION_CONFLICT');
    patchActual(copy, { thresholdA: 20 }); copy.analysis.perRoi[1].rect.y = 20;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('DUPLICATE_FIELD_SELECTION_CONFLICT');
    copy.excludedFromStatistics = true; setup.design.assignments.pop();
    const excluded = ifSampleStatistics(setup.samples, setup.design);
    expect(excluded.aggregation.designStatus).toBe('confirmed'); expect(excluded.counts).toMatchObject({ nRecords: 31, nExcludedRecords: 1, nBio: 6 });
    expect(excluded.aggregation.excludedSampleIds).toEqual(['duplicate']); expect(setup.samples).toHaveLength(31);
  });

  it('blocks missing, repeated and overlapping selected ROIs but allows touching half-open boundaries', () => {
    const setup = withRois(); expect(ifSampleStatistics(setup.samples, setup.design).aggregation.designStatus).toBe('confirmed');
    setup.design.assignments[0].roiIds = ['a', 'a'];
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_ROI_SELECTION_INVALID');
    setup.design.assignments[0].roiIds = ['missing'];
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_ROI_NOT_FOUND');
    setup.design.assignments[0].roiIds = ['a', 'b']; setup.samples[0].analysis.perRoi[1].rect.x = 9;
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_ROI_OVERLAP');
    setup.samples[0].analysis.perRoi[1].rect.x = 10; setup.design.regionMode = 'whole_image';
    expect(codes(ifSampleStatistics(setup.samples, setup.design))).toContain('IF_WHOLE_IMAGE_SELECTION_CONFLICT');
  });

  it('rejects duplicate stored ROI IDs, inconsistent reference settings and malformed selected geometry or metrics', () => {
    const duplicateIds = withRois(); duplicateIds.samples[0].analysis.perRoi[1].roiId = 'a';
    expect(codes(ifSampleStatistics(duplicateIds.samples, duplicateIds.design))).toContain('IF_ROI_ID_CONFLICT');
    const reference = withRois(); reference.samples[0].analysis.perRoi[0].backgroundA = 5;
    expect(codes(ifSampleStatistics(reference.samples, reference.design))).toContain('IF_RESULT_CONFIGURATION_CONFLICT');
    const geometry = withRois(); geometry.samples[0].analysis.perRoi[0].rect.x = -1;
    expect(codes(ifSampleStatistics(geometry.samples, geometry.design))).toContain('IF_REGION_GEOMETRY_INVALID');
    const value = fixture(); value.samples[0].analysis.overall.pearsonMasked = 2;
    expect(codes(ifSampleStatistics(value.samples, value.design))).toContain('IF_METRIC_VALUE_INVALID');
  });
});
