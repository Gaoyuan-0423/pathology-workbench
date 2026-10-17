/**
 * 程序化 API：一键完成"分析 → 诊断报告 → JSON 导出"。
 * UI 诊断面板与 window.__pathologyAPI 均走此模块。
 */
import { evaluateDiagnostics, type DiagnosticsReport } from './advisor.ts';
import { generateMethodsEn, generateMethodsZh } from './methods.ts';
import { compareGroups } from './analysis/statistics.ts';
import { METRIC_LABELS } from './api-labels.ts';
import type { MetricKey } from './api-labels.ts';
import type { AnalysisResult, ProjectState, SampleRecord } from './types.ts';

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
  /** 每样本指标（样本库） */
  samples: Array<Record<string, unknown>>;
  /** 组间统计（样本 ≥2 组时） */
  statistics: Record<string, unknown> | null;
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

export interface SampleStatsSource {
  samples: SampleRecord[];
  metric: MetricKey;
}

/** 由样本库构造分组值（与 UI 统计面板同逻辑） */
export function groupsFromSamples(source: SampleStatsSource): { name: string; values: number[] }[] {
  const byGroup = new Map<string, number[]>();
  for (const sample of source.samples) {
    const value = sample.metrics[source.metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const list = byGroup.get(sample.group) ?? [];
    list.push(value);
    byGroup.set(sample.group, list);
  }
  return [...byGroup.entries()].map(([name, values]) => ({ name, values }));
}

/** 诊断 + 报告组装（分析结果由调用方提供——UI 走 Worker，测试可直接喂） */
export function buildFullReport(
  project: ProjectState,
  result: AnalysisResult | null,
  qc: import('./analysis/engine.ts').EngineQc | null,
  statsSource: SampleStatsSource | null,
): FullReport {
  const groups = statsSource ? groupsFromSamples(statsSource) : [];
  const statsReport =
    groups.length >= 2 && groups.reduce((sum, g) => sum + g.values.length, 0) >= 4
      ? compareGroups(groups)
      : null;

  const diagnostics = evaluateDiagnostics({ project, result, qc, statsReport });

  const metrics: Record<string, number | null> = {};
  if (result) {
    for (const key of METRIC_KEYS) {
      metrics[METRIC_LABELS[key]] = result.overall[key as keyof typeof result.overall] as number | null;
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
    },
    metrics,
    samples: project.samples.map((sample) => ({
      name: sample.name,
      group: sample.group,
      imageName: sample.imageName,
      ...Object.fromEntries(METRIC_KEYS.map((key) => [METRIC_LABELS[key], sample.metrics[key]])),
    })),
    statistics: statsReport
      ? {
          omnibusParametric: statsReport.omnibusParametric,
          omnibusNonParametric: statsReport.omnibusNonParametric,
          pairwise: statsReport.pairwise,
          recommendation: statsReport.recommendation,
        }
      : null,
    diagnostics,
    methods: {
      zh: generateMethodsZh(project, result),
      en: generateMethodsEn(project, result),
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
