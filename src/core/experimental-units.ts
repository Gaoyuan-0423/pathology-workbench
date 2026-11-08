import { mean } from './stats.ts';
import type {
  ExperimentalUnitAggregation,
  MetricKey,
  PathologyExperimentalAssignment,
  PathologyExperimentalDesign,
  PathologyDesignIssue,
  PathologySectionSummary,
  PathologyUnitSummary,
  SampleRecord,
  ValueGroup,
} from './types.ts';

const PROFILES = new Set(['h_dab', 'h_eosin', 'masson', 'if_coloc']);

interface FieldEntry {
  assignment: PathologyExperimentalAssignment;
  samples: DeclaredMeasurementRecord[];
  value: number | null;
}

/** Assay-neutral input: callers supply a real measured field value, never a fabricated stain record. */
export interface DeclaredMeasurementRecord {
  id: string;
  group: string;
  sourceId?: string;
  excludedFromStatistics?: boolean;
  value: number | null;
  /** Optional measurement-equivalence key for duplicate views of the same source. */
  signature?: string;
}
export interface DeclaredFieldSummary {
  assignment: PathologyExperimentalAssignment;
  sampleIds: string[];
  value: number | null;
}
export interface DeclaredUnitAggregation<M extends string> extends Omit<ExperimentalUnitAggregation, 'metric'> {
  metric: M;
  fields: DeclaredFieldSummary[];
}

function knownIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().toLowerCase() !== 'unknown';
}

function numericMetric(sample: SampleRecord, metric: MetricKey): number | null {
  const value = sample.metrics[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function descriptiveGroups(samples: DeclaredMeasurementRecord[]): ValueGroup[] {
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const values = groups.get(sample.group) ?? [];
    const value = sample.value;
    if (value !== null) values.push(value);
    groups.set(sample.group, values);
  }
  return [...groups].map(([name, values]) => ({ name, values }));
}

/**
 * Independently declared units, sections and fields are not inferred from names.
 * Confirmed aggregation: deduplicate fields, average fields within each section,
 * then average sections within each unit. A missing field invalidates that unit's
 * metric rather than silently changing its predeclared weights.
 */
export function aggregateExperimentalUnits(
  samples: SampleRecord[],
  metric: MetricKey,
  design?: PathologyExperimentalDesign,
): ExperimentalUnitAggregation {
  const issues: PathologyDesignIssue[] = [];
  const included = samples.filter((sample) => sample.excludedFromStatistics !== true);
  if (design?.confirmed === true && design.kind === 'independent') {
    const profiles = new Set<string>();
    for (const sample of included) {
      if (!sample.profileId || !PROFILES.has(sample.profileId)) {
        issues.push({ code: 'PROFILE_UNKNOWN', message: '记录缺少已知分析预设；历史未知记录仅可作描述。', sampleIds: [sample.id] });
      } else profiles.add(sample.profileId);
      if (sample.profileId === 'if_coloc') issues.push({ code: 'IF_SAMPLE_METRIC_UNSUPPORTED', message: 'IF 共定位记录不提供染色指标；请使用专用 IF 实验单位统计。', sampleIds: [sample.id] });
      if (sample.metrics.roiId !== null) issues.push({ code: 'MEASUREMENT_SCOPE_UNSUPPORTED', message: '当前实验单位汇总仅支持整图测量；ROI 测量尚无已确认的区域来源身份，仅保留描述，不进行组间推断。', sampleIds: [sample.id] });
    }
    if (profiles.size > 1) issues.push({ code: 'PROFILE_MIXED', message: '不同分析预设的记录不能混合进行同一次组间推断。' });
  }
  const { fields: _fields, ...aggregation } = aggregateDeclaredUnits(samples.map((sample) => ({
    id: sample.id, group: sample.group, sourceId: sample.sourceId, excludedFromStatistics: sample.excludedFromStatistics,
    value: numericMetric(sample, metric),
  })), metric, design, issues);
  return aggregation;
}

/** Shared identity checks and field → section → unit arithmetic, independent of assay type. */
export function aggregateDeclaredUnits<M extends string>(
  samples: DeclaredMeasurementRecord[],
  metric: M,
  design?: PathologyExperimentalDesign,
  additionalIssues: PathologyDesignIssue[] = [],
): DeclaredUnitAggregation<M> {
  const excludedSampleIds = samples.filter((sample) => sample.excludedFromStatistics === true).map((sample) => sample.id);
  const excludedIds = new Set(excludedSampleIds);
  samples = samples.filter((sample) => sample.excludedFromStatistics !== true);
  const output: DeclaredUnitAggregation<M> = {
    designStatus: 'unconfirmed', issues: [...additionalIssues], metric, measurementLevel: 'record', aggregation: null,
    groups: descriptiveGroups(samples), units: [], fields: [], duplicateFieldGroups: [],
    includedSampleIds: samples.map((sample) => sample.id), excludedSampleIds,
  };
  const issue = (code: string, message: string, sampleIds?: string[]) => {
    output.issues.push({ code, message, ...(sampleIds ? { sampleIds } : {}) });
  };
  if (design?.kind === 'paired' || design?.kind === 'repeated') {
    output.designStatus = 'unsupported';
    issue('DESIGN_UNSUPPORTED', '配对和重复测量设计当前仅提供描述，不进行独立组推断。');
    return output;
  }
  if (!design || design.confirmed !== true) {
    issue('DESIGN_UNCONFIRMED', '实验单位、切片与视野层级尚未确认；记录数不是生物学样本量。');
    return output;
  }
  if (design.kind !== 'independent') issue('DESIGN_KIND_INVALID', '实验设计类型无效。');
  if (design.aggregation !== 'equal_sections') issue('AGGREGATION_UNSUPPORTED', '当前仅支持预声明的切片等权汇总口径。');
  if (!knownIdentity(design.controlGroup)) issue('CONTROL_GROUP_MISSING', '请明确指定实验设计中的对照组。');

  const samplesById = new Map<string, DeclaredMeasurementRecord>();
  for (const sample of samples) {
    if (!knownIdentity(sample.id) || samplesById.has(sample.id)) issue('SAMPLE_ID_CONFLICT', '样本库记录 ID 缺失或重复。', [sample.id]);
    samplesById.set(sample.id, sample);
  }

  const assignments = new Map<string, PathologyExperimentalAssignment>();
  if (!Array.isArray(design.assignments)) {
    issue('ASSIGNMENTS_INVALID', '实验单位映射必须是数组。');
  } else for (const assignment of design.assignments) {
    if (assignment && excludedIds.has(assignment.sampleId)) continue;
    if (!assignment || !['sampleId', 'sourceId', 'unitId', 'sectionId', 'fieldId', 'group'].every((key) => knownIdentity(assignment[key as keyof PathologyExperimentalAssignment]))) {
      issue('ASSIGNMENT_INVALID', '每条映射必须包含记录、来源、实验单位、切片、视野和组别的明确身份。');
      continue;
    }
    if (assignments.has(assignment.sampleId)) {
      issue('ASSIGNMENT_CONFLICT', '同一记录出现重复或冲突的实验单位映射。', [assignment.sampleId]);
    } else assignments.set(assignment.sampleId, assignment);
    if (!samplesById.has(assignment.sampleId)) issue('ASSIGNMENT_STALE', '实验单位映射引用了不存在的样本库记录。', [assignment.sampleId]);
  }

  const groupsByUnit = new Map<string, Set<string>>();
  const sourceFields = new Map<string, string>();
  const fieldSources = new Map<string, string>();
  const fields = new Map<string, FieldEntry>();
  for (const sample of samples) {
    const assignment = assignments.get(sample.id);
    if (!assignment) {
      issue('ASSIGNMENT_MISSING', '样本库记录缺少实验单位映射。', [sample.id]);
      continue;
    }
    if (sample.group !== assignment.group) issue('GROUP_CONFLICT', '记录组别与实验单位映射不一致；请先核对。', [sample.id]);
    if (knownIdentity(sample.sourceId) && sample.sourceId !== assignment.sourceId) {
      issue('SOURCE_ID_CONFLICT', '映射中的来源身份与已知原图身份不一致。', [sample.id]);
    }
    const unitGroups = groupsByUnit.get(assignment.unitId) ?? new Set<string>();
    unitGroups.add(assignment.group);
    groupsByUnit.set(assignment.unitId, unitGroups);
    const fieldKey = JSON.stringify([assignment.unitId, assignment.sectionId, assignment.fieldId]);
    const previousField = sourceFields.get(assignment.sourceId);
    if (previousField !== undefined && previousField !== fieldKey) {
      issue('SOURCE_FIELD_CONFLICT', '同一整图来源被映射到不同单位、切片或视野；请核对，不能重复计权。', [sample.id]);
    }
    sourceFields.set(assignment.sourceId, fieldKey);
    const previousSource = fieldSources.get(fieldKey);
    if (previousSource !== undefined && previousSource !== assignment.sourceId) {
      issue('FIELD_SOURCE_CONFLICT', '同一预声明视野对应不同来源；当前没有重复采集的合并规则，请先核对。', [sample.id]);
    }
    fieldSources.set(fieldKey, assignment.sourceId);
    const value = sample.value;
    const field = fields.get(fieldKey);
    if (field) {
      field.samples.push(sample);
      if (field.value !== value) issue('DUPLICATE_FIELD_VALUE_CONFLICT', '重复视野的指标值不一致；不能任意取首条或平均。', field.samples.map((s) => s.id));
      if (field.samples[0].signature !== sample.signature) issue('DUPLICATE_FIELD_SELECTION_CONFLICT', '重复视野的实际选区、指标值或配置不一致；不能只比较均值后折叠。', field.samples.map((s) => s.id));
    } else fields.set(fieldKey, { assignment, samples: [sample], value });
  }
  for (const [unitId, groups] of groupsByUnit) {
    if (groups.size > 1) issue('UNIT_GROUP_CONFLICT', `独立设计中的单位 ${unitId} 被分配到多个组。`);
  }
  if (!samples.some((sample) => assignments.get(sample.id)?.group === design.controlGroup)) {
    issue('CONTROL_GROUP_NOT_FOUND', '映射中没有可用的指定对照组。');
  }
  output.duplicateFieldGroups = [...fields.values()].filter((field) => field.samples.length > 1).map((field) => field.samples.map((sample) => sample.id));
  output.fields = [...fields.values()].map((field) => ({ assignment: field.assignment, sampleIds: field.samples.map((sample) => sample.id), value: field.value }));
  if (output.issues.length) {
    output.designStatus = 'invalid';
    return output;
  }

  const unitFields = new Map<string, typeof fields>();
  for (const [fieldKey, field] of fields) {
    const entries = unitFields.get(field.assignment.unitId) ?? new Map();
    entries.set(fieldKey, field);
    unitFields.set(field.assignment.unitId, entries);
  }
  const units: PathologyUnitSummary[] = [];
  for (const [unitId, entries] of unitFields) {
    const bySection = new Map<string, FieldEntry[]>();
    for (const field of entries.values()) {
      const sectionFields = bySection.get(field.assignment.sectionId) ?? [];
      sectionFields.push(field);
      bySection.set(field.assignment.sectionId, sectionFields);
    }
    const sections: PathologySectionSummary[] = [...bySection].map(([sectionId, sectionFields]) => ({
      sectionId,
      value: sectionFields.some((field) => field.value === null) ? null : mean(sectionFields.map((field) => field.value!)),
      nFields: sectionFields.length,
      sampleIds: sectionFields.flatMap((field) => field.samples.map((sample) => sample.id)),
      sourceIds: [...new Set(sectionFields.map((field) => field.assignment.sourceId))],
    }));
    const unit: PathologyUnitSummary = {
      unitId, group: [...entries.values()][0].assignment.group,
      value: sections.some((section) => section.value === null) ? null : mean(sections.map((section) => section.value!)),
      nSections: sections.length, nFields: entries.size,
      sampleIds: sections.flatMap((section) => section.sampleIds),
      sourceIds: [...new Set(sections.flatMap((section) => section.sourceIds))], sections,
    };
    if (unit.value === null) issue('FIELD_METRIC_MISSING', `单位 ${unitId} 的预声明视野缺少有效指标；保留描述并排除该单位的组级数值，未重新分配权重。`, unit.sampleIds);
    units.push(unit);
  }
  const groupValues = new Map<string, number[]>();
  for (const unit of units) {
    const values = groupValues.get(unit.group) ?? [];
    if (unit.value !== null) values.push(unit.value);
    groupValues.set(unit.group, values);
  }
  if (output.duplicateFieldGroups.length) issue('DUPLICATE_FIELDS_COLLAPSED', '重复来源的同一视野仅计一次；重复记录不增加视野权重或生物学样本量。');
  output.designStatus = 'confirmed';
  output.measurementLevel = 'biological_unit';
  output.aggregation = 'equal_sections';
  output.units = units;
  output.groups = [...groupValues].map(([name, values]) => ({ name, values }));
  return output;
}
