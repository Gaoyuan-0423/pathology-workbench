import type { FullReport } from '../core/api.ts';
import type { GroupStatsReport } from '../core/analysis/statistics.ts';
import { METRIC_LABELS } from '../core/api-labels.ts';
import { t } from '../i18n.ts';

/** Localize report presentation fields without translating user names or numeric data. */
export function localizeReport(report: FullReport) {
  const localizeTest = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('label' in value) || typeof value.label !== 'string') return value;
    return { ...value, label: t(value.label) };
  };
  const localizeIssues = <T extends { message: string }>(issues: T[]) => issues.map(issue => ({ ...issue, message: t(issue.message) }));
  const localizeStatistics = (statistics: GroupStatsReport | null) => statistics ? {
    ...statistics,
    omnibusParametric: localizeTest(statistics.omnibusParametric),
    omnibusNonParametric: localizeTest(statistics.omnibusNonParametric),
    issues: localizeIssues(statistics.issues),
    recommendation: t(statistics.recommendation),
  } : null;
  const metricKeys = new Set(Object.values(METRIC_LABELS));
  return {
    ...report,
    image: report.image ? { ...report.image, note: report.image.note ? t(report.image.note) : report.image.note } : null,
    metrics: Object.fromEntries(Object.entries(report.metrics).map(([key, value]) => [t(key), value])),
    samples: report.samples.map(sample => Object.fromEntries(Object.entries(sample).map(([key, value]) => [metricKeys.has(key) ? t(key) : key, value]))),
    statistics: localizeStatistics(report.statistics),
    sampleStatistics: {
      ...report.sampleStatistics,
      aggregation: { ...report.sampleStatistics.aggregation, issues: localizeIssues(report.sampleStatistics.aggregation.issues) },
      report: localizeStatistics(report.sampleStatistics.report),
    },
    ifStatistics: {
      ...report.ifStatistics,
      aggregation: { ...report.ifStatistics.aggregation, issues: localizeIssues(report.ifStatistics.aggregation.issues) },
      report: localizeStatistics(report.ifStatistics.report),
    },
    diagnostics: {
      ...report.diagnostics,
      summary: t(report.diagnostics.summary),
      issues: report.diagnostics.issues.map(issue => ({
        ...issue, category: t(issue.category), message: t(issue.message),
        suggestion: issue.suggestion ? t(issue.suggestion) : issue.suggestion,
      })),
    },
  };
}
