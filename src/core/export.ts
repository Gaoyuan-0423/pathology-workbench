import { t } from '../i18n.ts';
/**
 * 导出：Excel（多工作表）/ CSV / 图表 SVG·PNG / 叠加层 PNG / Methods 文本。
 * Excel 走 SheetJS；CSV 手写 RFC 4180 + UTF-8 BOM（与 pcr-workbench 同款）。
 */
import * as XLSX from 'xlsx';
import type { GroupStatsReport } from './analysis/statistics.ts';
import { significanceStars } from './stats.ts';
import type { AnalysisResult, ColocConfig, IfAnalysisResult, IfSampleRecord, IfUndefinedReason, PathologyExperimentalDesign, ProjectState, RoiMetrics, SampleRecord } from './types.ts';
import { sampleStatistics, type SampleStatistics } from './sample-statistics.ts';
import { ifSampleStatistics, type IfSampleStatistics, type IfExperimentalDesign } from './if-statistics.ts';
import { IF_METRIC_LABELS } from './if-report-labels.ts';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { METRIC_LABELS, type MetricKey } from './api-labels.ts';

export { METRIC_LABELS };

export function metricValue(metrics: RoiMetrics, key: MetricKey): number | null {
  switch (key) {
    case 'positiveFraction':
      return metrics.positiveFraction;
    case 'labelingIndex':
      return metrics.labelingIndex;
    case 'hScore':
      return metrics.hScore;
    case 'integratedOpticalDensity':
      return metrics.integratedOpticalDensity;
    case 'meanOpticalDensity':
      return metrics.meanOpticalDensity;
    case 'densityPerMm2':
      return metrics.densityPerMm2;
    default: {
      const never: never = key;
      return never;
    }
  }
}

function aoaToSheet(aoa: (string | number | null)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa);
}

/** Saved IF records have independent Methods; keep every paragraph within Excel's cell limit. */
function methodsRows(text: string): string[][] {
  return text.split('\n\n').flatMap((paragraph) => {
    const chunks: string[][] = [];
    let chunk = '';
    for (const character of paragraph) {
      if (chunk.length + character.length > 30000) { chunks.push([chunk]); chunk = ''; }
      chunk += character;
    }
    chunks.push([chunk]);
    return chunks;
  });
}

type ExportCell = string | number | null;

function numeric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordAoa(samples: SampleRecord[], design?: PathologyExperimentalDesign, metric: MetricKey = 'positiveFraction'): ExportCell[][] {
  const { aggregation } = sampleStatistics(samples, metric, design);
  const headings = ['样本', '分组', '图像', '阳性面积', '阳性核', '总核', '标注指数', 'H-score', 'IOD', '平均OD', '记录 ID', '来源 ID', '分析预设', '实验单位 ID', '切片 ID', '视野 ID', '设计状态', '指标层级', '排除于统计', '映射来源 ID', '触边核', '折算总数', '密度(个/mm²)', '指标可用性'];
  return [headings.map((heading) => t(heading)), ...samples.map((sample): ExportCell[] => {
    // Ambiguous mappings are preserved in the design sheet, never resolved by choosing the first.
    const mappings = Array.isArray(design?.assignments) ? design.assignments.filter((item) => item?.sampleId === sample.id) : [];
    const mapping = mappings.length === 1 ? mappings[0] : undefined;
    const stainValue = (value: number | null) => sample.profileId === 'if_coloc' ? null : numeric(value);
    return [sample.name, sample.group, sample.imageName,
      stainValue(sample.metrics.positiveFraction), stainValue(sample.metrics.positiveNuclei), stainValue(sample.metrics.totalNuclei),
      stainValue(sample.metrics.labelingIndex), stainValue(sample.metrics.hScore), stainValue(sample.metrics.integratedOpticalDensity), stainValue(sample.metrics.meanOpticalDensity),
      sample.id, sample.sourceId ?? '', sample.profileId ?? '',
      mapping?.unitId ?? '', mapping?.sectionId ?? '', mapping?.fieldId ?? '', aggregation.designStatus, 'record', sample.excludedFromStatistics === true ? 'true' : 'false', mapping?.sourceId ?? '',
      stainValue(sample.metrics.borderNuclei), stainValue(sample.metrics.estimatedTotalCount), stainValue(sample.metrics.densityPerMm2),
      sample.profileId === 'if_coloc' ? t('不支持：IF 共定位记录不提供染色指标。') : ''];
  })];
}

export function unitMetricsAoa(stats: SampleStatistics): ExportCell[][] {
  return [
    [t('实验单位 ID'), t('分组'), t('指标'), t('单位均值'), 'nBio', 'nImages', t('切片数'), t('视野数'), t('原记录 IDs'), t('来源 IDs'), t('设计状态')],
    ...stats.aggregation.units.map((unit): ExportCell[] => [unit.unitId, unit.group, t(METRIC_LABELS[stats.aggregation.metric]), numeric(unit.value), unit.value === null ? 0 : 1, unit.sourceIds.length, unit.nSections, unit.nFields, JSON.stringify(unit.sampleIds), JSON.stringify(unit.sourceIds), stats.aggregation.designStatus]),
  ];
}

function sectionAoa(stats: SampleStatistics): ExportCell[][] {
  return [
    [t('实验单位 ID'), t('分组'), t('切片 ID'), t('指标'), t('切片均值'), t('视野数'), t('原记录 IDs'), t('来源 IDs')],
    ...stats.aggregation.units.flatMap((unit) => unit.sections.map((section): ExportCell[] => [unit.unitId, unit.group, section.sectionId, t(METRIC_LABELS[stats.aggregation.metric]), numeric(section.value), section.nFields, JSON.stringify(section.sampleIds), JSON.stringify(section.sourceIds)])),
  ];
}

function designAoa(stats: SampleStatistics, design?: PathologyExperimentalDesign): ExportCell[][] {
  const { aggregation, report, counts } = stats;
  return [
    [t('项目'), t('值')],
    [t('设计状态'), aggregation.designStatus], [t('推断状态'), report.inferenceStatus],
    [t('设计类型'), design?.kind ?? ''], [t('确认声明'), design?.confirmed === true ? 'true' : 'false'],
    [t('对照组'), design?.controlGroup ?? ''], [t('汇总规则'), aggregation.aggregation ?? ''],
    [t('指标'), t(METRIC_LABELS[aggregation.metric])], [t('指标层级'), aggregation.measurementLevel],
    ['nBio', counts.nBio], ['nImages', counts.nImages], ['nRecords', counts.nRecords],
    [t('纳入记录数'), counts.nIncludedRecords], [t('排除记录数'), counts.nExcludedRecords],
    [t('映射单位数'), counts.nUnitsMapped], [t('切片数'), counts.nSections], [t('视野数'), counts.nFields],
    [t('说明'), t('nBio 为所选指标可用的独立单位数；nImages 为纳入记录中去重来源图像数；nRecords 为全部保存记录数。空白表示身份或设计未确认。')],
    [t('说明'), t('先去重视野，再求切片内视野均值与单位内切片等权均值；每单位向组贡献一个数值。')],
    [], [t('问题代码'), t('说明'), t('原记录 IDs')],
    ...[...aggregation.issues, ...report.issues].map((issue): ExportCell[] => [issue.code, t(issue.message), JSON.stringify(issue.sampleIds ?? [])]),
    [], [t('重复视野记录 IDs')],
    ...aggregation.duplicateFieldGroups.map((ids): ExportCell[] => [JSON.stringify(ids)]),
    [], [t('记录 ID'), t('来源 ID'), t('实验单位 ID'), t('切片 ID'), t('视野 ID'), t('分组')],
    ...(Array.isArray(design?.assignments) ? design.assignments : []).map((mapping): ExportCell[] => [mapping?.sampleId ?? '', mapping?.sourceId ?? '', mapping?.unitId ?? '', mapping?.sectionId ?? '', mapping?.fieldId ?? '', mapping?.group ?? '']),
  ];
}

const IF_COLUMNS = [
  ['recordKind', '记录类型'], ['recordId', '记录 ID'], ['name', '样本'], ['group', '分组'], ['imageName', '图像'], ['sourceId', '来源 ID'], ['addedAt', '记录时间 (Unix ms)'], ['excluded', '排除于统计'],
  ['schemaVersion', 'IF 结果格式'], ['normalizationScope', '背景与阈值参考范围'], ['regionScope', '测量区域'], ['roiId', 'ROI ID'], ['roiName', '区域名称'],
  ['x', '区域 x (px)'], ['y', '区域 y (px)'], ['w', '区域宽度 (px)'], ['h', '区域高度 (px)'], ['imageWidth', '工作图宽度 (px)'], ['imageHeight', '工作图高度 (px)'],
  ['pixelCount', '区域像素数'], ['positivePixelsA', 'A 阳性像素数'], ['positivePixelsB', 'B 阳性像素数'], ['unionPixels', '阳性并集像素数'], ['intersectionPixels', '阳性交集像素数'],
  ['channelA', '通道 A'], ['channelB', '通道 B'], ['thresholdMode', 'IF 阈值模式'], ['backgroundPercentile', 'IF 背景百分位'], ['manualA', '配置手动阈值 A'], ['manualB', '配置手动阈值 B'],
  ['backgroundA', '实际背景 A'], ['backgroundB', '实际背景 B'], ['thresholdA', '实际阈值 A'], ['thresholdB', '实际阈值 B'],
  ['pearsonAll', '全像素 Pearson'], ['pearsonMasked', '掩膜 Pearson'], ['mandersM1', 'Manders M1'], ['mandersM2', 'Manders M2'],
  ['sumA', '区域 A 强度和'], ['sumB', '区域 B 强度和'], ['sumAInBPositive', 'B 阳性内 A 强度和'], ['sumBInAPositive', 'A 阳性内 B 强度和'],
  ['undefinedReasons', '未定义原因代码'], ['undefinedExplanation', '未定义原因'], ['note', '说明'],
] as const;

const IF_REASON_LABELS: Record<IfUndefinedReason, string> = {
  pearson_all_insufficient_pixels: '全像素 Pearson：有效像素少于 2 个。',
  pearson_all_zero_variance: '全像素 Pearson：至少一个通道为零方差。',
  pearson_masked_insufficient_pixels: '掩膜 Pearson：并集内像素少于 2 个。',
  pearson_masked_zero_variance: '掩膜 Pearson：至少一个通道为零方差。',
  manders_m1_zero_denominator: 'Manders M1：区域 A 总强度为零。',
  manders_m2_zero_denominator: 'Manders M2：区域 B 总强度为零。',
};

type IfExportRow = Partial<Record<(typeof IF_COLUMNS)[number][0], ExportCell>>;
type IfRecordMetadata = Pick<IfExportRow, 'recordKind' | 'recordId' | 'name' | 'group' | 'imageName' | 'sourceId' | 'addedAt' | 'excluded'>;

function canonicalIfRows(analysis: IfAnalysisResult, config: ColocConfig, metadata: IfRecordMetadata): IfExportRow[] {
  return [analysis.overall, ...analysis.perRoi].map((region): IfExportRow => ({
    ...metadata, schemaVersion: analysis.schemaVersion, normalizationScope: analysis.normalizationScope,
    regionScope: region.roiId === null ? 'whole_image' : 'roi', roiId: region.roiId, roiName: region.roiName,
    ...region.rect, imageWidth: analysis.imageWidth, imageHeight: analysis.imageHeight,
    pixelCount: region.pixelCount, positivePixelsA: region.positivePixelsA, positivePixelsB: region.positivePixelsB,
    unionPixels: region.unionPixels, intersectionPixels: region.intersectionPixels,
    channelA: ['R', 'G', 'B'][region.channelA], channelB: ['R', 'G', 'B'][region.channelB],
    thresholdMode: config.thresholdMode, backgroundPercentile: config.backgroundPercentile, manualA: config.manualA, manualB: config.manualB,
    backgroundA: region.backgroundA, backgroundB: region.backgroundB, thresholdA: region.thresholdA, thresholdB: region.thresholdB,
    pearsonAll: numeric(region.pearsonAll), pearsonMasked: numeric(region.pearsonMasked), mandersM1: numeric(region.mandersM1), mandersM2: numeric(region.mandersM2),
    sumA: region.sumA, sumB: region.sumB, sumAInBPositive: region.sumAInBPositive, sumBInAPositive: region.sumBInAPositive,
    undefinedReasons: JSON.stringify(region.undefinedReasons), undefinedExplanation: region.undefinedReasons.map((reason) => t(IF_REASON_LABELS[reason])).join(' '),
    note: t('本表保留区域原始系数；IF 组间推断另见已确认设计的单位统计，像素、ROI 与保存记录数量不代表独立生物学重复。'),
  }));
}

function currentIfRows(project: ProjectState, result: AnalysisResult | null): IfExportRow[] {
  if (project.profileId !== 'if_coloc' || !result) return [];
  const metadata: IfRecordMetadata = { recordKind: 'current', imageName: project.image?.name ?? '' };
  if (result.ifAnalysis) return canonicalIfRows(result.ifAnalysis, project.coloc, metadata);
  const legacy = result.coloc;
  if (!legacy) return [];
  return [{ ...metadata, schemaVersion: 'legacy_coloc', normalizationScope: 'legacy_whole_image', regionScope: 'whole_image',
    channelA: ['R', 'G', 'B'][legacy.channelA], channelB: ['R', 'G', 'B'][legacy.channelB],
    backgroundA: legacy.backgroundA, backgroundB: legacy.backgroundB, thresholdA: legacy.thresholdA, thresholdB: legacy.thresholdB,
    pearsonAll: numeric(legacy.pearsonAll), pearsonMasked: numeric(legacy.pearsonMasked), mandersM1: numeric(legacy.mandersM1), mandersM2: numeric(legacy.mandersM2),
    note: t('旧格式仅记录整图系数；ROI、像素计数、分母与未定义原因未记录。旧零值可能是占位，未生成新的 ROI 测量。'),
  }];
}

function savedIfRows(samples: IfSampleRecord[]): IfExportRow[] {
  return samples.flatMap((sample) => canonicalIfRows(sample.analysis, sample.config, {
    recordKind: 'saved', recordId: sample.id, name: sample.name, group: sample.group, imageName: sample.imageName, sourceId: sample.sourceId, addedAt: sample.addedAt,
    excluded: sample.excludedFromStatistics === true ? 'true' : 'false',
  }));
}

function ifRowsAoa(rows: IfExportRow[]): ExportCell[][] {
  return [IF_COLUMNS.map(([, label]) => t(label)), ...rows.map((row) => IF_COLUMNS.map(([key]) => row[key] ?? null))];
}

/** Raw whole-image/ROI measurements remain separate from confirmed unit statistics. */
export function ifMetricsCsv(project: ProjectState, result: AnalysisResult | null = null): string {
  return aoaCsv(ifRowsAoa([...currentIfRows(project, result), ...savedIfRows(project.ifSamples ?? [])]));
}

export function ifUnitMetricsAoa(stats: IfSampleStatistics): ExportCell[][] {
  return [
    [t('实验单位 ID'), t('分组'), t('指标'), t('IF 区域模式'), t('单位均值'), 'nBio', 'nImages', t('切片数'), t('视野数'), t('选定区域数'), t('原记录 IDs'), t('来源 IDs'), t('设计状态')],
    ...stats.aggregation.units.map((unit): ExportCell[] => [unit.unitId, unit.group, t(IF_METRIC_LABELS[stats.aggregation.metric]), stats.aggregation.regionMode,
      numeric(unit.value), unit.value === null ? 0 : 1, unit.sourceIds.length, unit.nSections, unit.nFields, unit.nRegions,
      JSON.stringify(unit.sampleIds), JSON.stringify(unit.sourceIds), stats.aggregation.designStatus]),
  ];
}

/** One value per confirmed independent unit; no rows are fabricated from record counts. */
export function ifUnitMetricsCsv(project: ProjectState): string {
  return aoaCsv(ifUnitMetricsAoa(ifSampleStatistics(project.ifSamples ?? [], project.ifExperimentalDesign)));
}

function ifFieldAoa(stats: IfSampleStatistics): ExportCell[][] {
  const { aggregation } = stats;
  return [
    [t('原记录 IDs'), t('来源 ID'), t('分组'), t('实验单位 ID'), t('切片 ID'), t('视野 ID'), t('指标'), t('IF 区域模式'), t('视野均值'), t('选定区域数'), t('选定 ROI IDs'),
      'ROI ID', t('区域名称'), t('区域 x (px)'), t('区域 y (px)'), t('区域宽度 (px)'), t('区域高度 (px)'), t('区域系数'), t('指标层级'), t('设计状态')],
    ...aggregation.fields.flatMap((field) => (field.regions.length ? field.regions : [null]).map((region): ExportCell[] => [
      JSON.stringify(field.sampleIds), field.sourceId, field.group, field.unitId, field.sectionId, field.fieldId, t(IF_METRIC_LABELS[aggregation.metric]), aggregation.regionMode,
      numeric(field.value), field.nRegions, JSON.stringify(field.roiIds), region?.roiId ?? null, region?.roiName ?? null,
      region?.rect?.x ?? null, region?.rect?.y ?? null, region?.rect?.w ?? null, region?.rect?.h ?? null, numeric(region?.value), aggregation.measurementLevel, aggregation.designStatus,
    ])),
  ];
}

function ifSectionAoa(stats: IfSampleStatistics): ExportCell[][] {
  return [
    [t('实验单位 ID'), t('分组'), t('切片 ID'), t('指标'), t('切片均值'), t('视野数'), t('选定区域数'), t('原记录 IDs'), t('来源 IDs')],
    ...stats.aggregation.units.flatMap((unit) => unit.sections.map((section): ExportCell[] => [unit.unitId, unit.group, section.sectionId,
      t(IF_METRIC_LABELS[stats.aggregation.metric]), numeric(section.value), section.nFields, section.nRegions, JSON.stringify(section.sampleIds), JSON.stringify(section.sourceIds)])),
  ];
}

function ifDesignAoa(stats: IfSampleStatistics, design?: IfExperimentalDesign): ExportCell[][] {
  const { aggregation, report, counts } = stats;
  return [
    [t('项目'), t('值')], [t('设计状态'), aggregation.designStatus], [t('推断状态'), report.inferenceStatus],
    [t('设计类型'), design?.kind ?? ''], [t('确认声明'), design?.confirmed === true ? 'true' : 'false'], [t('对照组'), design?.controlGroup ?? ''],
    [t('汇总规则'), aggregation.aggregation], [t('指标'), t(IF_METRIC_LABELS[aggregation.metric])], [t('IF 区域模式'), aggregation.regionMode], [t('指标层级'), aggregation.measurementLevel],
    ['nBio', counts.nBio], ['nImages', counts.nImages], ['nRecords', counts.nRecords], [t('纳入记录数'), counts.nIncludedRecords], [t('排除记录数'), counts.nExcludedRecords],
    [t('映射单位数'), counts.nUnitsMapped], [t('切片数'), counts.nSections], [t('视野数'), counts.nFields], [t('选定区域数'), counts.nRegions],
    [t('说明'), t('nBio 为所选指标可用的独立单位数；nImages 为纳入记录中去重来源图像数；nRecords 为全部保存记录数。空白表示身份或设计未确认。')],
    [t('说明'), t('equal_rois 对显式选定且互不重叠的 ROI 系数等权求均值；随后视野去重、切片内视野等权、单位内切片等权。未进行 Fisher 变换或像素池化。')],
    [t('说明'), t('视野表每行对应一个选定区域，重复显示的视野均值不代表额外重复；单位表每个单位仅有一行。')],
    [], [t('问题代码'), t('说明'), t('原记录 IDs')],
    ...[...aggregation.issues, ...report.issues].map((issue): ExportCell[] => [issue.code, t(issue.message), JSON.stringify(issue.sampleIds ?? [])]),
    [], [t('重复视野记录 IDs')], ...aggregation.duplicateFieldGroups.map((ids): ExportCell[] => [JSON.stringify(ids)]),
    [], [t('记录 ID'), t('来源 ID'), t('实验单位 ID'), t('切片 ID'), t('视野 ID'), t('分组'), t('选定 ROI IDs')],
    ...(Array.isArray(design?.assignments) ? design.assignments : []).map((mapping): ExportCell[] => [mapping?.sampleId ?? '', mapping?.sourceId ?? '', mapping?.unitId ?? '', mapping?.sectionId ?? '', mapping?.fieldId ?? '', mapping?.group ?? '', JSON.stringify(mapping?.roiIds ?? [])]),
  ];
}

function statisticalTestsAoa(report: GroupStatsReport): ExportCell[][] {
  return [
    [t('检验'), t('统计量'), 'df1', 'df2', 'p', t('校正p'), t('显著性')],
    ...[report.omnibusParametric, report.omnibusNonParametric].filter((test) => test !== null).map((test): ExportCell[] => [t(test.label), numeric(test.statistic), numeric(test.df1), numeric(test.df2), numeric(test.p), null, significanceStars(test.p)]),
    ...report.pairwise.map((row): ExportCell[] => [row.label, null, null, null, numeric(row.p), numeric(row.adjustedP), significanceStars(row.adjustedP)]),
    [], [t('正态性 (D\'Agostino–Pearson)'), 'p'], ...report.normality.map((item): ExportCell[] => [item.group, item.p === null ? t('n<8 未检验') : numeric(item.p)]),
    [t('方差齐性 (Brown–Forsythe)'), numeric(report.leveneP)], [], [t('建议'), t(report.recommendation)],
  ];
}

function appendIfStatisticsSheets(book: XLSX.WorkBook, project: ProjectState): void {
  if (!(project.ifSamples?.length || project.ifExperimentalDesign)) return;
  const stats = ifSampleStatistics(project.ifSamples ?? [], project.ifExperimentalDesign);
  XLSX.utils.book_append_sheet(book, aoaToSheet(ifDesignAoa(stats, project.ifExperimentalDesign)), t('IF 实验设计'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(ifFieldAoa(stats)), t('IF 视野与区域'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(ifSectionAoa(stats)), t('IF 切片汇总'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(ifUnitMetricsAoa(stats)), t('IF 实验单位'));
  const { report } = stats;
  const groups: ExportCell[][] = [
    [t('分组'), t('指标'), t('指标层级'), 'nBio', 'nImages', 'nRecords', t('纳入记录数'), t('排除记录数'), t('切片数'), t('视野数'), t('选定区域数'), t('有效数值数'), t('均值'), t('标准差'), t('中位数')],
    ...report.groupNames.map((group, index): ExportCell[] => {
      const count = stats.groupCounts.find((entry) => entry.group === group)!;
      return [group, t(IF_METRIC_LABELS[stats.aggregation.metric]), stats.aggregation.measurementLevel, count.nBio, count.nImages, count.nRecords, count.nIncludedRecords, count.nExcludedRecords,
        count.nSections, count.nFields, count.nRegions, report.ns[index], numeric(report.means[index]), numeric(report.sds[index]), numeric(report.medians[index])];
    }), [], [t('建议'), t(report.recommendation)],
  ];
  XLSX.utils.book_append_sheet(book, aoaToSheet(groups), t('IF 分组描述'));
  if (stats.inference) XLSX.utils.book_append_sheet(book, aoaToSheet(statisticalTestsAoa(report)), t('IF 统计检验'));
}

export function buildWorkbook(
  samples: SampleRecord[],
  _legacyReport: GroupStatsReport | null,
  project: ProjectState,
  result: AnalysisResult | null,
  metric: MetricKey = 'positiveFraction',
): XLSX.WorkBook {
  // A supplied historical report cannot authorize inference for the current records/design.
  const stats = sampleStatistics(samples, metric, project.experimentalDesign);
  const { report } = stats;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, aoaToSheet(recordAoa(samples, project.experimentalDesign, metric)), t('样本指标'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(unitMetricsAoa(stats)), t('实验单位'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(sectionAoa(stats)), t('切片汇总'));
  XLSX.utils.book_append_sheet(book, aoaToSheet(designAoa(stats, project.experimentalDesign)), t('实验设计'));
  const groupAoa: ExportCell[][] = [
    [t('分组'), t('指标层级'), 'nBio', 'nImages', 'nRecords', t('纳入记录数'), t('排除记录数'), t('映射单位数'), t('切片数'), t('视野数'), t('有效数值数'), t('均值'), t('标准差'), t('中位数')],
    ...report.groupNames.map((name, index): ExportCell[] => {
      const counts = stats.groupCounts.find((group) => group.group === name)!;
      return [name, stats.aggregation.measurementLevel, counts.nBio, counts.nImages, counts.nRecords, counts.nIncludedRecords, counts.nExcludedRecords, counts.nUnitsMapped, counts.nSections, counts.nFields,
        report.ns[index], numeric(report.means[index]), numeric(report.sds[index]), numeric(report.medians[index])];
    }),
    [], [t('说明'), t(report.recommendation)],
  ];
  XLSX.utils.book_append_sheet(book, aoaToSheet(groupAoa), t('分组描述'));
  const currentIf = currentIfRows(project, result);
  const savedIf = savedIfRows(project.ifSamples ?? []);
  if (currentIf.length) XLSX.utils.book_append_sheet(book, aoaToSheet(ifRowsAoa(currentIf)), t('当前 IF'));
  if (savedIf.length) XLSX.utils.book_append_sheet(book, aoaToSheet(ifRowsAoa(savedIf)), t('历史 IF'));
  appendIfStatisticsSheets(book, project);

  if (stats.inference) {
    const statsAoa: ExportCell[][] = [
      [t('检验'), t('统计量'), 'df1', 'df2', 'p', t('校正p'), t('显著性')],
      ...[report.omnibusParametric, report.omnibusNonParametric].filter((test) => test !== null).map((test): ExportCell[] => [t(test.label), numeric(test.statistic), numeric(test.df1), numeric(test.df2), numeric(test.p), null, significanceStars(test.p)]),
      ...report.pairwise.map((row): ExportCell[] => [row.label, null, null, null, numeric(row.p), numeric(row.adjustedP), significanceStars(row.adjustedP)]),
      [], [t('正态性 (D\'Agostino–Pearson)'), 'p'],
      ...report.normality.map((item): ExportCell[] => [item.group, item.p === null ? t('n<8 未检验') : numeric(item.p)]),
      [t('方差齐性 (Brown–Forsythe)'), numeric(report.leveneP)],
      [], [t('建议'), t(report.recommendation)],
    ];
    XLSX.utils.book_append_sheet(book, aoaToSheet(statsAoa), t('统计检验'));
  }
  const methodsProject = { ...project, samples };
  XLSX.utils.book_append_sheet(book, aoaToSheet([[t('Methods（中文）')], ...methodsRows(generateMethodsZh(methodsProject, result, metric)), [], ['Methods (English)'], ...methodsRows(generateMethodsEn(methodsProject, result, metric))]), 'Methods');
  XLSX.utils.book_append_sheet(book, aoaToSheet([
    [t('项目'), t('值')], [t('软件'), 'Pathology Workbench v0.1'], [t('导出时间'), new Date().toISOString()],
    [t('染色预设'), project.profileId], [t('阈值模式'), project.threshold.mode], [t('自动方法'), project.threshold.method],
    [t('背景百分位'), project.threshold.backgroundPercentile], [t('对照片'), project.threshold.controlImageName ?? t('未标定')],
    [t('核面积门控 (px)'), `${project.segmentation.minAreaPx}–${project.segmentation.maxAreaPx}`], [t('最小圆度'), project.segmentation.minCircularity],
    ['μm/px', project.calibration.mpp ?? t('未标定')], ['nRecords', samples.length], ['nImages', stats.counts.nImages], ['nBio', stats.counts.nBio],
    [t('说明'), t('本表图像参数仅对应当前图像；历史记录的分析设置须分别核对。')],
  ]), t('项目信息'));
  return book;
}

export function exportWorkbook(samples: SampleRecord[], report: GroupStatsReport | null, project: ProjectState, result: AnalysisResult | null, metric: MetricKey = 'positiveFraction'): void {
  const book = buildWorkbook(samples, report, project, result, metric);
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `pathology-workbench-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function aoaCsv(rows: ExportCell[][]): string {
  return `\uFEFF${rows.map((row) => row.map((cell) => csvEscape(cell === null ? '' : String(cell))).join(',')).join('\n')}`;
}

/** Saved image records remain technical descriptions, even when unit inference is available. */
export function metricsCsv(samples: SampleRecord[], design?: PathologyExperimentalDesign, metric: MetricKey = 'positiveFraction'): string {
  return aoaCsv(recordAoa(samples, design, metric));
}

export function unitMetricsCsv(samples: SampleRecord[], design?: PathologyExperimentalDesign, metric: MetricKey = 'positiveFraction'): string {
  return aoaCsv(unitMetricsAoa(sampleStatistics(samples, metric, design)));
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, name: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), name);
}

export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const dimensions = svg.match(/width="(\d+)"\s+height="(\d+)"/);
  const width = dimensions ? Number(dimensions[1]) : 560;
  const height = dimensions ? Number(dimensions[2]) : 360;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('SVG 渲染失败'));
    element.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
}

export function overlayToPngBlob(overlay: ImageData, base: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d')!;
  const holder = ctx.createImageData(base.width, base.height);
  holder.data.set(base.data);
  ctx.putImageData(holder, 0, 0);
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = overlay.width;
  overlayCanvas.height = overlay.height;
  overlayCanvas.getContext('2d')!.putImageData(overlay, 0, 0);
  ctx.globalAlpha = 0.75;
  ctx.drawImage(overlayCanvas, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
}
