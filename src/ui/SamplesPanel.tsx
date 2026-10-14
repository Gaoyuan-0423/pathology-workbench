import { useMemo, useState } from 'react';
import { compareGroups } from '../core/analysis/statistics.ts';
import { groupBarChartSvg } from '../core/chart.ts';
import {
  downloadBlob,
  downloadText,
  exportWorkbook,
  METRIC_LABELS,
  metricsCsv,
  svgToPngBlob,
} from '../core/export.ts';
import { generateMethodsEn, generateMethodsZh } from '../core/methods.ts';
import { formatP, significanceStars } from '../core/stats.ts';
import type { AnalysisResult, MetricKey, ProjectState, SampleRecord } from '../core/types.ts';

interface SamplesPanelProps {
  project: ProjectState;
  /** 与诊断面板共享的比较指标 */
  statsMetric: MetricKey;
  canAddSample: boolean;
  disabled: boolean;
  onAddSample: (group: string) => void;
  onUpdateSample: (id: string, patch: Partial<SampleRecord>) => void;
  onDeleteSample: (id: string) => void;
  onStatus: (message: string, kind: 'ok' | 'error') => void;
  analysisResult: AnalysisResult | null;
  onStatsMetricChange: (metric: MetricKey) => void;
}

const METRIC_OPTIONS: MetricKey[] = [
  'positiveFraction',
  'labelingIndex',
  'integratedOpticalDensity',
  'meanOpticalDensity',
  'densityPerMm2',
];

export default function SamplesPanel({
  project,
  statsMetric: externalMetric,
  canAddSample,
  disabled,
  onAddSample,
  onUpdateSample,
  onDeleteSample,
  onStatus,
  onStatsMetricChange,
  analysisResult,
}: SamplesPanelProps) {
  const [group, setGroup] = useState('对照组');
  const [metric, setMetric] = useState<MetricKey>(externalMetric);

  const groups = useMemo(() => {
    const byGroup = new Map<string, number[]>();
    for (const sample of project.samples) {
      const value = sample.metrics[metric];
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null;
      if (numeric === null) continue;
      const list = byGroup.get(sample.group) ?? [];
      list.push(numeric);
      byGroup.set(sample.group, list);
    }
    return [...byGroup.entries()].map(([name, values]) => ({ name, values }));
  }, [project.samples, metric]);

  const report = useMemo(
    () => (groups.reduce((sum, g) => sum + g.values.length, 0) >= 4 && groups.length >= 2 ? compareGroups(groups) : null),
    [groups],
  );

  const chartSvg = useMemo(() => {
    if (!report) return null;
    try {
      return groupBarChartSvg(report, {
        yLabel: METRIC_LABELS[metric],
        title: `${METRIC_LABELS[metric]} 组间比较`,
      });
    } catch {
      return null;
    }
  }, [report, metric]);

  return (
    <section className="panel">
      <h3>样本库与组间统计</h3>
      <div className="field-row">
        <input
          type="text"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          placeholder="分组名"
          disabled={disabled}
        />
        <button
          type="button"
          disabled={!canAddSample || disabled || group.trim() === ''}
          onClick={() => onAddSample(group.trim())}
        >
          加入样本
        </button>
      </div>
      <p className="panel-note">
        每导入一张图并完成分析后加入样本库（只保存指标，不保存像素）；比较不同处理组的图像请分别加入并标注分组。
      </p>

      {project.samples.length > 0 && (
        <ul className="roi-list">
          {project.samples.map((sample) => (
            <li key={sample.id}>
              <input
                className="sample-name"
                value={sample.group}
                onChange={(event) => onUpdateSample(sample.id, { group: event.target.value })}
                aria-label="分组"
              />
              <span className="roi-size" title={sample.imageName}>{sample.name}</span>
              <button type="button" className="link-button" onClick={() => onDeleteSample(sample.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {project.samples.length >= 2 && (
        <div className="field-row">
          <label>比较指标</label>
          <select
            value={metric}
            onChange={(event) => {
              setMetric(event.target.value as MetricKey);
              onStatsMetricChange(event.target.value as MetricKey);
            }}
          >
            {METRIC_OPTIONS.map((key) => (
              <option key={key} value={key}>{METRIC_LABELS[key]}</option>
            ))}
          </select>
        </div>
      )}

      {(report || analysisResult) && (
        <div className="stats-block">
          {report && (
            <>
          <table className="result-table">
            <thead>
              <tr>
                <th>检验</th>
                <th>统计量</th>
                <th>p / 校正 p</th>
                <th>显著性</th>
              </tr>
            </thead>
            <tbody>
              {report.omnibusParametric && (
                <tr>
                  <td>{report.omnibusParametric.label}</td>
                  <td>{formatNumber(report.omnibusParametric.statistic)}</td>
                  <td>{formatP(report.omnibusParametric.p)}</td>
                  <td>{significanceStars(report.omnibusParametric.p)}</td>
                </tr>
              )}
              {report.omnibusNonParametric && (
                <tr>
                  <td>{report.omnibusNonParametric.label}</td>
                  <td>{formatNumber(report.omnibusNonParametric.statistic)}</td>
                  <td>{formatP(report.omnibusNonParametric.p)}</td>
                  <td>{significanceStars(report.omnibusNonParametric.p)}</td>
                </tr>
              )}
              {report.pairwise.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>—</td>
                  <td>
                    {formatP(row.p)} → {formatP(row.adjustedP)}
                  </td>
                  <td>{significanceStars(row.adjustedP)}</td>
                </tr>
              ))}
            </tbody>
          </table>
              <p className="panel-note">{report.recommendation}</p>
            </>
          )}
          {analysisResult && !report && (
            <p className="panel-note">
              当前整图结果可导出（阈值 {analysisResult.thresholdUsed} · 核阈值 {analysisResult.nuclearThresholdUsed}）；加入 ≥2 组样本后可做组间统计。
            </p>
          )}
          {chartSvg && (
            <div
              className="chart-preview"
              // 图表为本地生成的静态 SVG
              dangerouslySetInnerHTML={{ __html: chartSvg }}
            />
          )}
          <div className="export-buttons">
            <button
              type="button"
              onClick={() => {
                exportWorkbook(project.samples, report, project, analysisResult);
                onStatus('已导出 Excel（指标/统计/Methods/项目信息）', 'ok');
              }}
            >
              导出 Excel
            </button>
            <button
              type="button"
              onClick={() => {
                downloadText(metricsCsv(project.samples), `pathology-metrics-${dateStamp()}.csv`, 'text/csv;charset=utf-8');
                onStatus('已导出 CSV', 'ok');
              }}
            >
              导出 CSV
            </button>
            {chartSvg && (
              <>
                <button
                  type="button"
                  onClick={() => downloadText(chartSvg, `pathology-chart-${dateStamp()}.svg`, 'image/svg+xml')}
                >
                  图表 SVG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void svgToPngBlob(chartSvg).then((blob) => {
                      downloadBlob(blob, `pathology-chart-${dateStamp()}.png`);
                      onStatus('已导出图表 PNG', 'ok');
                    });
                  }}
                >
                  图表 PNG
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const text = `${generateMethodsZh(project, analysisResult)}\n\n${generateMethodsEn(project, analysisResult)}`;
                  try {
                    await navigator.clipboard.writeText(text);
                    onStatus('Methods 已复制到剪贴板', 'ok');
                  } catch {
                    downloadText(text, `pathology-methods-${dateStamp()}.txt`);
                    onStatus('剪贴板不可用，已下载 Methods 文本', 'ok');
                  }
                })();
              }}
            >
              复制 Methods
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function formatNumber(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
