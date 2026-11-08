import { compareGroups, type GroupStatsReport } from './analysis/statistics.ts';
import { aggregateExperimentalUnits } from './experimental-units.ts';
import type { ExperimentalUnitAggregation, MetricKey, PathologyExperimentalDesign, SampleRecord } from './types.ts';

export interface SampleCounts {
  nRecords: number;
  nIncludedRecords: number;
  nExcludedRecords: number;
  /** Unique source images, or null when source identity is incomplete. */
  nImages: number | null;
  /** Units with a usable value for the selected metric; never an image count. */
  nBio: number | null;
  nUnitsMapped: number | null;
  nSections: number | null;
  nFields: number | null;
}

export interface SampleStatistics {
  aggregation: ExperimentalUnitAggregation;
  report: GroupStatsReport;
  inference: boolean;
  counts: SampleCounts;
  groupCounts: Array<SampleCounts & { group: string }>;
}

/** Shared report boundary for UI, API, Methods and exports. */
export function sampleStatistics(
  samples: SampleRecord[],
  metric: MetricKey,
  design?: PathologyExperimentalDesign,
): SampleStatistics {
  // IF RoiMetrics contains compatibility placeholders (including Manders M1
  // in positiveFraction), not stain measurements. Keep raw records untouched.
  const descriptiveSamples = samples.map((sample) => sample.profileId === 'if_coloc'
    ? { ...sample, metrics: { ...sample.metrics, [metric]: NaN } }
    : sample);
  const aggregation = aggregateExperimentalUnits(descriptiveSamples, metric, design);
  const unsupportedIds = samples.filter((sample) => sample.profileId === 'if_coloc' && !sample.excludedFromStatistics).map((sample) => sample.id);
  if (unsupportedIds.length && !aggregation.issues.some((issue) => issue.code === 'IF_SAMPLE_METRIC_UNSUPPORTED')) {
    aggregation.issues.push({ code: 'IF_SAMPLE_METRIC_UNSUPPORTED', message: 'IF 共定位记录不提供染色指标；兼容占位值不作为测量结果显示或统计。', sampleIds: unsupportedIds });
  }
  const report = compareGroups(aggregation.groups, {
    designStatus: aggregation.designStatus,
    controlGroup: design?.controlGroup,
  });
  const confirmed = aggregation.measurementLevel === 'biological_unit';
  const countsFor = (records: SampleRecord[], group?: string): SampleCounts => {
    const includedRecords = records.filter((record) => !record.excludedFromStatistics);
    const units = aggregation.units.filter((unit) => group === undefined || unit.group === group);
    const sources = confirmed ? units.flatMap((unit) => unit.sourceIds) : includedRecords.map((record) => record.sourceId);
    const sourceKnown = sources.every((source) => typeof source === 'string' && source.trim() !== '' && source.trim().toLowerCase() !== 'unknown');
    return {
      nRecords: records.length,
      nIncludedRecords: includedRecords.length,
      nExcludedRecords: records.length - includedRecords.length,
      nImages: sourceKnown ? new Set(sources).size : null,
      nBio: confirmed ? units.filter((unit) => unit.value !== null).length : null,
      nUnitsMapped: confirmed ? units.length : null,
      nSections: confirmed ? units.reduce((sum, unit) => sum + unit.nSections, 0) : null,
      nFields: confirmed ? units.reduce((sum, unit) => sum + unit.nFields, 0) : null,
    };
  };
  return {
    aggregation,
    report,
    inference: report.inferenceStatus === 'available',
    counts: countsFor(samples),
    groupCounts: aggregation.groups.map(({ name }) => ({ group: name, ...countsFor(samples.filter((sample) => sample.group === name), name) })),
  };
}
