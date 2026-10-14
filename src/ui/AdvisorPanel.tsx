import { useMemo, useState } from 'react';
import { buildFullReport, groupsFromSamples } from '../core/api.ts';
import { evaluateDiagnostics, type DiagnosticsReport } from '../core/advisor.ts';
import { compareGroups } from '../core/analysis/statistics.ts';
import { downloadText } from '../core/export.ts';
import type { AnalysisResult, MetricKey, ProjectState } from '../core/types.ts';

interface AdvisorPanelProps {
  project: ProjectState;
  analysis: AnalysisResult | null;
  /** 当前统计指标（与统计面板共享选择时需一致；这里默认阳性面积） */
  statsMetric: MetricKey;
  onStatus: (message: string, kind: 'ok' | 'error') => void;
}

const SEVERITY_META: Record<string, { label: string; className: string }> = {
  error: { label: '问题', className: 'sev-error' },
  warn: { label: '警告', className: 'sev-warn' },
  info: { label: '提示', className: 'sev-info' },
  ok: { label: '通过', className: 'sev-ok' },
};

export default function AdvisorPanel({
  project,
  analysis,
  statsMetric,
  onStatus,
}: AdvisorPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const report: DiagnosticsReport | null = useMemo(() => {
    if (!project.pixels) return null;
    const groups = groupsFromSamples({ samples: project.samples, metric: statsMetric });
    const stats =
      groups.length >= 2 && groups.reduce((sum, g) => sum + g.values.length, 0) >= 4
        ? compareGroups(groups)
        : null;
    return evaluateDiagnostics({ project, result: analysis, qc: analysis?.qc ?? null, statsReport: stats });
  }, [project, analysis, statsMetric]);

  const fullReport = useMemo(() => {
    if (!report) return null;
    return buildFullReport(
      project,
      analysis,
      analysis?.qc ?? null,
      { samples: project.samples, metric: statsMetric },
    );
  }, [report, project, analysis, statsMetric]);

  const counts = report
    ? {
        error: report.issues.filter((issue) => issue.severity === 'error').length,
        warn: report.issues.filter((issue) => issue.severity === 'warn').length,
        info: report.issues.filter((issue) => issue.severity === 'info').length,
      }
    : null;

  return (
    <section className="panel">
      <h3>一键体检 {report && <span className="advisor-score">{report.score} 分</span>}</h3>
      {!report && <p className="panel-note">导入图像后可对当前配置与结果做自动化体检。</p>}
      {report && counts && (
        <>
          <div className="sev-badges">
            {counts.error > 0 && <span className="sev-badge sev-error">问题 {counts.error}</span>}
            {counts.warn > 0 && <span className="sev-badge sev-warn">警告 {counts.warn}</span>}
            {counts.info > 0 && <span className="sev-badge sev-info">提示 {counts.info}</span>}
            {counts.error + counts.warn + counts.info === 0 && (
              <span className="sev-badge sev-ok">全部通过</span>
            )}
          </div>
          <p className="panel-note">{report.summary}</p>
          {report.issues.length > 0 && (
            <ul className="advisor-list">
              {(expanded ? report.issues : report.issues.slice(0, 4)).map((issue, index) => {
                const meta = SEVERITY_META[issue.severity];
                return (
                  <li key={index} className={`advisor-item ${meta.className}`}>
                    <span className="sev-tag">{meta.label}</span>
                    <div>
                      <p className="advisor-message">
                        <em>{issue.category}</em> · {issue.message}
                      </p>
                      {issue.suggestion && <p className="advisor-suggestion">→ {issue.suggestion}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {report.issues.length > 4 && (
            <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起' : `展开全部 ${report.issues.length} 条`}
            </button>
          )}
          <div className="export-buttons">
            <button
              type="button"
              onClick={() => {
                if (!fullReport) return;
                downloadText(
                  JSON.stringify(fullReport, null, 2),
                  `pathology-report-${new Date().toISOString().slice(0, 10)}.json`,
                  'application/json',
                );
                onStatus('已导出体检报告 JSON', 'ok');
              }}
            >
              导出报告 JSON
            </button>
            <button
              type="button"
              onClick={() => {
                if (!fullReport) return;
                const text = [
                  `# 病理工作台体检报告 ${fullReport.generatedAt}`,
                  `总评：${report.summary}（${report.score} 分）`,
                  '',
                  ...report.issues.map(
                    (issue) => `- [${issue.severity}] ${issue.category}：${issue.message}${issue.suggestion ? `\n  建议：${issue.suggestion}` : ''}`,
                  ),
                  '',
                  '## Methods（中）',
                  fullReport.methods.zh,
                  '## Methods (EN)',
                  fullReport.methods.en,
                ].join('\n');
                downloadText(text, `pathology-report-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
                onStatus('已导出体检报告 Markdown', 'ok');
              }}
            >
              导出报告 MD
            </button>
          </div>
        </>
      )}
    </section>
  );
}
