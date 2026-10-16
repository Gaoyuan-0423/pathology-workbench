import type { FullReport } from '../core/api.ts';
import { METRIC_LABELS } from '../core/api-labels.ts';
import { t } from '../i18n.ts';

/** Localize report presentation fields without translating user names or numeric data. */
export function localizeReport(report: FullReport) {
  const localizeTest = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('label' in value) || typeof value.label !== 'string') return value;
    return { ...value, label: t(value.label) };
  };
  const metricKeys = new Set(Object.values(METRIC_LABELS));
  return {
    ...report,
    image: report.image ? { ...report.image, note: report.image.note ? t(report.image.note) : report.image.note } : null,
    metrics: Object.fromEntries(Object.entries(report.metrics).map(([key, value]) => [t(key), value])),
    samples: report.samples.map(sample => Object.fromEntries(Object.entries(sample).map(([key, value]) => [metricKeys.has(key) ? t(key) : key, value]))),
    statistics: report.statistics ? {
      ...report.statistics,
      omnibusParametric: localizeTest(report.statistics.omnibusParametric),
      omnibusNonParametric: localizeTest(report.statistics.omnibusNonParametric),
      recommendation: typeof report.statistics.recommendation === 'string' ? t(report.statistics.recommendation) : report.statistics.recommendation,
    } : null,
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
