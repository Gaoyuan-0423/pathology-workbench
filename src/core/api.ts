/**
 * 程序化 API：一键完成"分析 → 诊断报告 → JSON 导出"。
 * UI 诊断面板与 window.__pathologyAPI 均走此模块。
 */
import { evaluateDiagnostics, type DiagnosticsReport } from './advisor.ts';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import type { GroupStatsReport } from './analysis/statistics.ts';
import { sampleStatistics, type SampleStatistics } from './sample-statistics.ts';
import { ifSampleStatistics, type IfSampleStatistics, type IfExperimentalDesign } from './if-statistics.ts';
import { METRIC_LABELS } from './api-labels.ts';
import type { MetricKey } from './api-labels.ts';
import type { AnalysisResult, IfAnalysisResult, IfRegionResult, IfSampleRecord, PathologyExperimentalDesign, ProjectState, SampleRecord } from './types.ts';

export { sampleStatistics } from './sample-statistics.ts';
export type { SampleStatistics, SampleCounts } from './sample-statistics.ts';
export { ifSampleStatistics } from './if-statistics.ts';

export interface FullReport {
  generatedAt: string;
  appVersion: string;
  /** 当前图像基础信息 */
  image: ProjectState['image'];
  profile: string;
  /** 实际生效参数摘要 */
  parameters: Record<string, unknown>;
  /** 整图定量指标 */
  metrics: Record<string, number | null>;
  /** Actual IF output; never relabelled as stain measurements. */
  colocalization: IfRegionResult | AnalysisResult['coloc'] | null;
  colocalizationStatus: 'canonical' | 'legacy_whole_image' | 'unavailable';
  ifAnalysis: IfAnalysisResult | null;
  ifSamples: IfSampleRecord[];
  ifExperimentalDesign: IfExperimentalDesign | null;
  ifStatistics: IfSampleStatistics;
  ifInferenceStatus: 'available' | 'descriptive_only';
  /** 每样本指标（样本库） */
  samples: Array<Record<string, unknown>>;
  experimentalDesign: PathologyExperimentalDesign | null;
  /** Record → field → section → unit mapping and explicit counts. */
  sampleStatistics: SampleStatistics;
  /** Inference is available only when inferenceStatus is available. */
  statistics: GroupStatsReport;
  /** 体检诊断 */
  diagnostics: DiagnosticsReport;
  /** 中英 Methods */
  methods: { zh: string; en: string };
}

const METRIC_KEYS: MetricKey[] = [
  'positiveFraction',
  'labelingIndex',
  'hScore',
  'integratedOpticalDensity',
  'meanOpticalDensity',
  'densityPerMm2',
];

/** Canonical IF measurements and unit statistics stay separate from stain metrics. */
export function ifReportData(project: ProjectState, result: AnalysisResult | null) {
  const current = project.profileId === 'if_coloc' ? result : null;
  const ifAnalysis = current?.ifAnalysis ?? null;
  const ifStatistics = ifSampleStatistics(project.ifSamples ?? [], project.ifExperimentalDesign);
  return {
    colocalization: ifAnalysis?.overall ?? current?.coloc ?? null,
    colocalizationStatus: ifAnalysis ? 'canonical' as const : current?.coloc ? 'legacy_whole_image' as const : 'unavailable' as const,
    ifAnalysis,
    ifSamples: project.ifSamples ?? [],
    ifExperimentalDesign: project.ifExperimentalDesign ?? null,
    ifStatistics,
    ifInferenceStatus: ifStatistics.inference ? 'available' as const : 'descriptive_only' as const,
  };
}

export interface SampleStatsSource {
  samples: SampleRecord[];
  metric: MetricKey;
  experimentalDesign?: PathologyExperimentalDesign;
}

/** Compatibility helper; values are descriptive unless the supplied design is confirmed. */
export function groupsFromSamples(source: SampleStatsSource): { name: string; values: number[] }[] {
  return sampleStatistics(source.samples, source.metric, source.experimentalDesign).aggregation.groups;
}

/** 诊断 + 报告组装（分析结果由调用方提供——UI 走 Worker，测试可直接喂） */
export function buildFullReport(
  project: ProjectState,
  result: AnalysisResult | null,
  qc: import('./analysis/engine.ts').EngineQc | null,
  statsSource: SampleStatsSource | null,
): FullReport {
  const metric = statsSource?.metric ?? 'positiveFraction';
  const samples = statsSource?.samples ?? project.samples;
  const reportProject = { ...project, samples };
  const stats = sampleStatistics(samples, metric, project.experimentalDesign);
  const statsReport = stats.report;

  const diagnostics = evaluateDiagnostics({ project, result, qc, statsReport: stats.inference ? statsReport : null });

  const metrics: Record<string, number | null> = {};
  if (result) {
    for (const key of METRIC_KEYS) {
      metrics[METRIC_LABELS[key]] = project.profileId === 'if_coloc' ? null : result.overall[key as keyof typeof result.overall] as number | null;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    image: project.image,
    profile: project.profileId,
    parameters: {
      threshold: project.threshold,
      segmentation: project.segmentation,
      calibration: project.calibration,
      coloc: project.profileId === 'if_coloc' ? project.coloc : undefined,
      stainOverride: project.stainOverrides[project.profileId] ?? undefined,
      effectiveThreshold: result?.thresholdUsed ?? null,
      nuclearThreshold: result?.nuclearThresholdUsed ?? null,
      analysisStatus: result ? 'ready' : 'unavailable',
      aiUsed: result?.aiUsed ?? null,
      aiRequested: result?.aiRequested ?? null,
      aiModelId: result?.aiModelId ?? null,
      aiRequestedModelId: result?.aiRequestedModelId ?? null,
      stainMetricsStatus: project.profileId === 'if_coloc' ? 'unsupported_if_colocalization' : result ? 'available' : 'unavailable',
    },
    metrics,
    ...ifReportData(project, result),
    samples: samples.map((sample) => ({
      id: sample.id,
      sourceId: sample.sourceId ?? null,
      profileId: sample.profileId ?? null,
      excludedFromStatistics: sample.excludedFromStatistics === true,
      stainMetricsStatus: sample.profileId === 'if_coloc' ? 'unsupported_if_colocalization' : 'recorded',
      name: sample.name,
      group: sample.group,
      imageName: sample.imageName,
      ...Object.fromEntries(METRIC_KEYS.map((key) => [METRIC_LABELS[key], sample.profileId === 'if_coloc' ? null : sample.metrics[key]])),
    })),
    experimentalDesign: project.experimentalDesign ?? null,
    sampleStatistics: stats,
    statistics: statsReport,
    diagnostics,
    methods: {
      zh: generateMethodsZh(reportProject, result, metric),
      en: generateMethodsEn(reportProject, result, metric),
    },
  };
}

/** 便捷封装：一键分析当前图像并产出完整报告（UI 主路径） */
export function analyzeProject(
  project: ProjectState,
  result: AnalysisResult | null,
  qc: import('./analysis/engine.ts').EngineQc | null,
  statsSource: SampleStatsSource | null,
): FullReport {
  return buildFullReport(project, result, qc, statsSource);
}

export { evaluateDiagnostics };
