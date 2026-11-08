import { compareGroups, type GroupStatsReport } from './analysis/statistics.ts';
import { aggregateDeclaredUnits } from './experimental-units.ts';
import { mean } from './stats.ts';
import type { SampleCounts } from './sample-statistics.ts';
import type {
  ColocConfig, ExperimentalUnitAggregation, IfRegionResult, IfSampleRecord, PathologyDesignIssue,
  PathologyExperimentalAssignment, PathologySectionSummary, PathologyUnitSummary,
} from './types.ts';

export type IfMetricKey = 'pearsonAll' | 'pearsonMasked' | 'mandersM1' | 'mandersM2';
export interface IfExperimentalAssignment extends PathologyExperimentalAssignment { roiIds: string[] }
export interface IfExperimentalDesign {
  kind: 'independent' | 'paired' | 'repeated';
  confirmed: boolean;
  controlGroup: string;
  aggregation: 'equal_sections';
  metric: IfMetricKey;
  regionMode: 'whole_image' | 'equal_rois';
  assignments: IfExperimentalAssignment[];
}
export interface IfSelectedRegionSummary {
  roiId: string | null;
  roiName: string | null;
  rect: IfRegionResult['rect'] | null;
  value: number | null;
}
export interface IfFieldSummary {
  sampleIds: string[];
  sourceId: string | null;
  group: string;
  unitId: string | null;
  sectionId: string | null;
  fieldId: string | null;
  roiIds: string[];
  regions: IfSelectedRegionSummary[];
  value: number | null;
  nRegions: number;
}
export interface IfSectionSummary extends PathologySectionSummary { nRegions: number }
export interface IfUnitSummary extends Omit<PathologyUnitSummary, 'sections'> {
  nRegions: number;
  sections: IfSectionSummary[];
}
export interface IfUnitAggregation extends Omit<ExperimentalUnitAggregation, 'metric' | 'units'> {
  metric: IfMetricKey;
  regionMode: 'whole_image' | 'equal_rois';
  fields: IfFieldSummary[];
  units: IfUnitSummary[];
}
export interface IfSampleCounts extends SampleCounts {
  /** Selected regions after confirmed field deduplication; never independent n. */
  nRegions: number | null;
}
export interface IfSampleStatistics {
  aggregation: IfUnitAggregation;
  report: GroupStatsReport;
  inference: boolean;
  counts: IfSampleCounts;
  groupCounts: Array<IfSampleCounts & { group: string }>;
}

export function createDefaultIfExperimentalDesign(): IfExperimentalDesign {
  return { kind: 'independent', confirmed: false, controlGroup: '', aggregation: 'equal_sections',
    metric: 'pearsonMasked', regionMode: 'whole_image', assignments: [] };
}

const METRICS: IfMetricKey[] = ['pearsonAll', 'pearsonMasked', 'mandersM1', 'mandersM2'];
const known = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'unknown';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const effectiveThreshold = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Actual auto thresholds may differ by image. Manual configuration compares effective 8-bit thresholds. */
function configurationKey(config: ColocConfig): string | null {
  if (!config || ![0, 1, 2].includes(config.channelA) || ![0, 1, 2].includes(config.channelB) ||
      !['auto', 'manual'].includes(config.thresholdMode) || !finite(config.backgroundPercentile) ||
      config.backgroundPercentile < 0 || config.backgroundPercentile > 100 ||
      (config.thresholdMode === 'manual' && (!finite(config.manualA) || !finite(config.manualB)))) return null;
  return JSON.stringify([config.channelA, config.channelB, config.backgroundPercentile, config.thresholdMode,
    ...(config.thresholdMode === 'manual' ? [effectiveThreshold(config.manualA), effectiveThreshold(config.manualB)] : [])]);
}

function validRect(rect: IfRegionResult['rect'] | undefined, width: number, height: number): rect is IfRegionResult['rect'] {
  return Boolean(rect && [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    rect.x + rect.w <= width && rect.y + rect.h <= height);
}
function overlaps(a: IfRegionResult['rect'], b: IfRegionResult['rect']): boolean {
  return Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);
}

/**
 * Selected ROI coefficients are averaged arithmetically to ONE field value.
 * This is neither a coefficient on pooled pixels nor a Fisher transformation.
 * Null propagates through field → section → unit without redistributing weights.
 */
export function ifSampleStatistics(samples: IfSampleRecord[], design?: IfExperimentalDesign): IfSampleStatistics {
  const metric = METRICS.includes(design?.metric as IfMetricKey) ? design!.metric : 'pearsonMasked';
  const regionMode = design?.regionMode === 'equal_rois' ? 'equal_rois' : 'whole_image';
  const issues: PathologyDesignIssue[] = [];
  const issue = (code: string, message: string, sampleId?: string) => issues.push({ code, message, ...(sampleId ? { sampleIds: [sampleId] } : {}) });
  if (design && !METRICS.includes(design.metric)) issue('IF_METRIC_UNSUPPORTED', 'IF 指标无效；请明确选择一个共定位系数。');
  if (design && !['whole_image', 'equal_rois'].includes(design.regionMode)) issue('IF_REGION_MODE_UNSUPPORTED', 'IF 区域汇总模式无效。');
  const assignmentList = Array.isArray(design?.assignments) ? design.assignments : [];
  const assignmentById = new Map(assignmentList.filter(Boolean).map((assignment) => [assignment.sampleId, assignment]));
  const configurations = new Set<string>();
  const recordFields: IfFieldSummary[] = [];
  const prepared = samples.map((sample) => {
    if (sample.excludedFromStatistics === true) return { id: sample.id, group: sample.group, sourceId: sample.sourceId, excludedFromStatistics: true, value: null };
    const assignment = assignmentById.get(sample.id);
    const configKey = configurationKey(sample.config);
    if (configKey === null) issue('IF_CONFIGURATION_INVALID', 'IF 记录的通道、背景或阈值配置无效。', sample.id);
    else configurations.add(configKey);
    const analysis = sample.analysis;
    const width = analysis?.imageWidth, height = analysis?.imageHeight;
    const structurallyValid = sample.profileId === 'if_coloc' && analysis?.schemaVersion === 'wisplab.if-colocalization/v1' &&
      analysis.normalizationScope === 'whole_image' && Number.isSafeInteger(width) && width > 0 &&
      Number.isSafeInteger(height) && height > 0 && analysis.overall?.roiId === null && Array.isArray(analysis.perRoi) &&
      sample.image?.workingWidth === width && sample.image?.workingHeight === height;
    if (!structurallyValid) issue('IF_RECORD_INVALID', 'IF 统计需要专用规范结果及一致的工作图尺寸，不能使用染色占位指标。', sample.id);
    const roiIds = Array.isArray(assignment?.roiIds) ? [...assignment.roiIds] : [];
    if (assignment && !Array.isArray(assignment.roiIds)) issue('IF_ROI_SELECTION_INVALID', 'IF 映射必须明确提供 ROI 选择数组；整图模式使用空数组。', sample.id);
    if (regionMode === 'whole_image' && roiIds.length) issue('IF_WHOLE_IMAGE_SELECTION_CONFLICT', '整图模式不能同时指定 ROI；请清空选区或切换汇总模式。', sample.id);
    if (regionMode === 'equal_rois' && (!roiIds.length || roiIds.some((id) => !known(id)) || new Set(roiIds).size !== roiIds.length)) {
      issue('IF_ROI_SELECTION_INVALID', 'ROI 等权模式需要至少一个明确且不重复的 ROI ID。', sample.id);
    }
    const available = Array.isArray(analysis?.perRoi) ? analysis.perRoi : [];
    if (available.some((region) => !region || !known(region.roiId)) || new Set(available.map((region) => region?.roiId)).size !== available.length) {
      issue('IF_ROI_ID_CONFLICT', '保存结果的 ROI ID 缺失或重复，无法唯一选择区域。', sample.id);
    }
    const byRoi = new Map(available.filter(Boolean).map((region) => [region.roiId, region]));
    const selected = regionMode === 'whole_image' ? [{ id: null, region: analysis?.overall }] : roiIds.map((id) => ({ id, region: byRoi.get(id) }));
    const regions: IfSelectedRegionSummary[] = selected.map(({ id, region }) => {
      if (!region) {
        issue('IF_ROI_NOT_FOUND', '指定的 IF 区域不在该记录的保存结果中。', sample.id);
        return { roiId: id, roiName: null, rect: null, value: null };
      }
      const rectangleValid = validRect(region.rect, width, height) &&
        (id !== null || (region.rect.x === 0 && region.rect.y === 0 && region.rect.w === width && region.rect.h === height));
      if (!rectangleValid) issue('IF_REGION_GEOMETRY_INVALID', 'IF 实际区域边界必须是工作图内的整数半开区；整图边界必须覆盖工作图。', sample.id);
      const reference = analysis?.overall;
      if (configKey !== null && (region.channelA !== sample.config.channelA || region.channelB !== sample.config.channelB ||
          !['backgroundA', 'backgroundB', 'thresholdA', 'thresholdB'].every((key) => {
            const value = region[key as keyof IfRegionResult];
            return finite(value) && value >= 0 && value <= 255 && value === reference?.[key as keyof IfRegionResult];
          }) || (sample.config.thresholdMode === 'manual' &&
            (region.thresholdA !== effectiveThreshold(sample.config.manualA) || region.thresholdB !== effectiveThreshold(sample.config.manualB))))) {
        issue('IF_RESULT_CONFIGURATION_CONFLICT', 'IF 区域实际通道、背景或阈值与保存配置及整图参考不一致。', sample.id);
      }
      const value = region[metric];
      const validValue = finite(value) && value >= (metric.startsWith('pearson') ? -1 : 0) && value <= 1;
      if (value !== null && !validValue) issue('IF_METRIC_VALUE_INVALID', 'IF 系数必须为其有效范围内的有限值或明确的 null。', sample.id);
      return { roiId: id, roiName: region.roiName, rect: rectangleValid ? { ...region.rect } : null, value: validValue ? value : null };
    });
    if (regionMode === 'equal_rois') for (let i = 0; i < regions.length; i += 1) for (let j = i + 1; j < regions.length; j += 1) {
      if (regions[i].rect && regions[j].rect && overlaps(regions[i].rect!, regions[j].rect!)) issue('IF_ROI_OVERLAP', '选定的 IF ROI 存在实际像素重叠；请使用同图内互不重叠的区域。', sample.id);
    }
    const value = !regions.length || regions.some((region) => region.value === null) ? null : mean(regions.map((region) => region.value!));
    recordFields.push({ sampleIds: [sample.id], sourceId: known(assignment?.sourceId) ? assignment.sourceId : known(sample.sourceId) ? sample.sourceId : null,
      group: sample.group, unitId: known(assignment?.unitId) ? assignment.unitId : null,
      sectionId: known(assignment?.sectionId) ? assignment.sectionId : null, fieldId: known(assignment?.fieldId) ? assignment.fieldId : null,
      roiIds: regionMode === 'whole_image' ? [] : roiIds, regions, value, nRegions: regions.length });
    // Display names / ROI IDs / selection order do not define equivalence.
    const geometryValues = regions.map((region) => JSON.stringify([region.rect?.x, region.rect?.y, region.rect?.w, region.rect?.h, region.value])).sort();
    return { id: sample.id, group: sample.group, sourceId: sample.sourceId, value,
      signature: JSON.stringify([width, height, configKey, analysis?.overall?.backgroundA, analysis?.overall?.backgroundB,
        analysis?.overall?.thresholdA, analysis?.overall?.thresholdB, geometryValues]) };
  });
  if (configurations.size > 1) issue('IF_CONFIGURATION_MIXED', '纳入的 IF 记录必须使用相同通道、背景百分位、阈值模式及有效手动阈值；自动阈值的实际数值可随图像不同。');
  const hierarchy = aggregateDeclaredUnits(prepared, metric, design, issues);
  const confirmed = hierarchy.measurementLevel === 'biological_unit';
  const fields = confirmed ? hierarchy.fields.map((field): IfFieldSummary => ({
    ...recordFields.find((record) => record.sampleIds[0] === field.sampleIds[0])!, sampleIds: field.sampleIds,
    sourceId: field.assignment.sourceId, group: field.assignment.group, unitId: field.assignment.unitId,
    sectionId: field.assignment.sectionId, fieldId: field.assignment.fieldId, value: field.value,
  })) : recordFields;
  const units: IfUnitSummary[] = hierarchy.units.map((unit) => ({ ...unit,
    nRegions: fields.filter((field) => field.unitId === unit.unitId).reduce((sum, field) => sum + field.nRegions, 0),
    sections: unit.sections.map((section) => ({ ...section,
      nRegions: fields.filter((field) => field.unitId === unit.unitId && field.sectionId === section.sectionId).reduce((sum, field) => sum + field.nRegions, 0) })),
  }));
  const aggregation: IfUnitAggregation = { ...hierarchy, regionMode, fields, units };
  const report = compareGroups(aggregation.groups, { designStatus: aggregation.designStatus, controlGroup: design?.controlGroup });
  const countsFor = (records: IfSampleRecord[], group?: string): IfSampleCounts => {
    const included = records.filter((record) => record.excludedFromStatistics !== true);
    const groupUnits = units.filter((unit) => group === undefined || unit.group === group);
    const sources = confirmed ? groupUnits.flatMap((unit) => unit.sourceIds) : included.map((record) => record.sourceId);
    return { nRecords: records.length, nIncludedRecords: included.length, nExcludedRecords: records.length - included.length,
      nImages: sources.every(known) ? new Set(sources).size : null,
      nBio: confirmed ? groupUnits.filter((unit) => unit.value !== null).length : null,
      nUnitsMapped: confirmed ? groupUnits.length : null,
      nSections: confirmed ? groupUnits.reduce((sum, unit) => sum + unit.nSections, 0) : null,
      nFields: confirmed ? groupUnits.reduce((sum, unit) => sum + unit.nFields, 0) : null,
      nRegions: confirmed ? groupUnits.reduce((sum, unit) => sum + unit.nRegions, 0) : null };
  };
  return { aggregation, report, inference: report.inferenceStatus === 'available', counts: countsFor(samples),
    groupCounts: aggregation.groups.map(({ name }) => ({ group: name, ...countsFor(samples.filter((sample) => sample.group === name), name) })) };
}
