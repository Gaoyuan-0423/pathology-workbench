import { t, useLanguage } from '../i18n.ts';
import { useMemo, useState } from 'react';
import { sampleStatistics } from '../core/api.ts';
import ExperimentalUnitsPanel from './ExperimentalUnitsPanel.tsx';
import { groupBarChartSvg } from '../core/chart.ts';
import {
  downloadBlob,
  downloadText,
  exportWorkbook,
  METRIC_LABELS,
  metricsCsv,
  unitMetricsCsv,
  svgToPngBlob,
} from '../core/export.ts';
import { generateMethodsEn, generateMethodsZh } from '../core/methods.ts';
import { formatP, significanceStars } from '../core/stats.ts';
import type { AnalysisResult, MetricKey, ProjectState, SampleRecord, PathologyExperimentalDesign } from '../core/types.ts';

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
  onDesignChange: (design: PathologyExperimentalDesign) => void;
  onResolveSources: () => void;
  resolvingSources: boolean;
}

const METRIC_OPTIONS: MetricKey[] = [
  'positiveFraction',
  'labelingIndex',
  'hScore',
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
  onDesignChange, onResolveSources, resolvingSources,
}: SamplesPanelProps) {
  const language = useLanguage();
  const [groupValue, setGroup] = useState<string | null>(null);
  const group = groupValue ?? t('对照组');
  const metric = externalMetric;

  const unitState = useMemo(() => sampleStatistics(project.samples, metric, project.experimentalDesign), [project.samples, metric, project.experimentalDesign]);
  const report = unitState.inference ? unitState.report : null;

  const chartSvg = useMemo(() => {
    if (unitState.aggregation.designStatus !== 'confirmed' || !unitState.aggregation.units.some((unit) => unit.value !== null)) return null;
    try {
      return groupBarChartSvg(unitState.report, {
        yLabel: t(METRIC_LABELS[metric], language),
        title: t(`${t(METRIC_LABELS[metric], language)} 组间比较`, language),
      });
    } catch {
      return null;
    }
  }, [unitState, metric, language]);

  return (
    <section className="panel">
      <h3>{t("样本库与组间统计")}</h3>
      <div className="field-row">
        <input
          type="text"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          placeholder={t("分组名")}
          disabled={disabled}
        />
        <button
          type="button"
          disabled={!canAddSample || disabled || group.trim() === ''}
          onClick={() => onAddSample(group.trim())}
        >
          {t("加入样本")}</button>
      </div>
      <p className="panel-note">
        {t("每张图分析后可加入样本库，保存指标、原文件和分析设置；历史条目若缺原图会明确提示。比较处理组请分别加入并标注分组。")}</p>

      {project.samples.length > 0 && <ExperimentalUnitsPanel project={project} disabled={disabled}
        onDesign={onDesignChange} onSample={onUpdateSample} onResolveSources={onResolveSources} resolvingSources={resolvingSources} onDeleteSample={onDeleteSample} />}

      {project.samples.length >= 2 && (
        <div className="field-row">
          <label>{t("比较指标")}</label>
          <select
            value={metric}
            onChange={(event) => {
              onStatsMetricChange(event.target.value as MetricKey);
            }}
          >
            {METRIC_OPTIONS.map((key) => (
              <option key={key} value={key}>{t(METRIC_LABELS[key])}</option>
            ))}
          </select>
        </div>
      )}

      {project.samples.length > 0 && <section aria-label={t('实验单位汇总')} className="unit-summary">
        <h4>{t('实验单位汇总')}</h4>
        <p>{t(unitState.aggregation.designStatus === 'confirmed' ? '已确认独立组设计；统计以单位均值为输入。' : '当前仅描述原始记录；实验设计未确认、无效或暂不支持。')}</p>
        <ul>{unitState.aggregation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{t(issue.message)}{issue.sampleIds?.length ? ` (${issue.sampleIds.join(', ')})` : ''}</li>)}
          {unitState.report.issues.map((issue, index) => <li key={`stats-${index}`}>{t(issue.message)}</li>)}</ul>
        <div className="unit-table-wrap"><table className="result-table">
          <thead><tr><th>{t('分组')}</th><th>{t('原始记录数')}</th><th>{t('纳入记录数')}</th><th>nImages</th><th>nFields</th><th>nBio</th></tr></thead>
          <tbody>{unitState.groupCounts.map((row) => <tr key={row.group}><td>{row.group}</td><td>{row.nRecords}</td><td>{row.nIncludedRecords}</td><td>{row.nImages ?? '—'}</td><td>{row.nFields ?? '—'}</td><td>{row.nBio ?? '—'}</td></tr>)}</tbody>
        </table></div>
        <p className="panel-note">{t('nImages 为已知来源图像数，nFields 为去重视野数，nBio 为当前指标的有效独立单位数。缺失身份显示为未知，不以记录数代替。')}</p>
        {unitState.aggregation.units.length > 0 && <div className="unit-table-wrap"><table className="result-table">
          <thead><tr><th>{t('独立单位 ID')}</th><th>{t('分组')}</th><th>{t('切片数')}</th><th>{t('视野数')}</th><th>{t('单位均值')}</th></tr></thead>
          <tbody>{unitState.aggregation.units.map((unit) => <tr key={unit.unitId}><td>{unit.unitId}</td><td>{unit.group}</td><td>{unit.nSections}</td><td>{unit.nFields}</td><td>{unit.value === null ? '—' : formatNumber(unit.value)}</td></tr>)}</tbody>
        </table></div>}
      </section>}

      {(project.samples.length > 0 || (project.ifSamples?.length ?? 0) > 0 || analysisResult) && (
        <div className="stats-block">
          {report && (
            <>
          <table className="result-table">
            <thead>
              <tr>
                <th>{t("检验")}</th>
                <th>{t("统计量")}</th>
                <th>{t("p / 校正 p")}</th>
                <th>{t("显著性")}</th>
              </tr>
            </thead>
            <tbody>
              {report.omnibusParametric && (
                <tr>
                  <td>{t(report.omnibusParametric.label)}</td>
                  <td>{formatNumber(report.omnibusParametric.statistic)}</td>
                  <td>{formatP(report.omnibusParametric.p)}</td>
                  <td>{significanceStars(report.omnibusParametric.p)}</td>
                </tr>
              )}
              {report.omnibusNonParametric && (
                <tr>
                  <td>{t(report.omnibusNonParametric.label)}</td>
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
              <p className="panel-note">{t(report.recommendation)}</p>
            </>
          )}
          {analysisResult && !report && (
            <p className="panel-note">
              {analysisResult.coloc ? t('当前 IF 结果可导出；可在 IF 结果库保存本次测量。')
                : <>{t("当前整图结果可导出（阈值 ")}{analysisResult.thresholdUsed} {t("· 核阈值 ")}{analysisResult.nuclearThresholdUsed}{t('）；组间推断需确认设计且各组有足够独立单位。')}</>}</p>
          )}
          {chartSvg && (
            <>
            <p className="panel-note">{t('图中每组均值和 SD 来自独立单位；没有有效值的组不绘制为零。')}</p>
            <div
              className="chart-preview"
              // 图表为本地生成的静态 SVG
              dangerouslySetInnerHTML={{ __html: chartSvg }}
            />
            </>
          )}
          <div className="export-buttons">
            <button
              type="button"
              onClick={() => {
                exportWorkbook(project.samples, report, project, analysisResult, metric);
                onStatus('已导出 Excel（指标/统计/Methods/项目信息）', 'ok');
              }}
            >
              {t("导出 Excel")}</button>
            <button
              type="button"
              onClick={() => {
                downloadText(metricsCsv(project.samples, project.experimentalDesign, metric), `pathology-metrics-${dateStamp()}.csv`, 'text/csv;charset=utf-8');
                onStatus('已导出 CSV', 'ok');
              }}
            >
              {t("导出 CSV")}</button>
            {unitState.aggregation.designStatus === 'confirmed' && <button type="button" onClick={() => downloadText(unitMetricsCsv(project.samples, project.experimentalDesign, metric), `pathology-units-${dateStamp()}.csv`, 'text/csv;charset=utf-8')}>{t('导出单位汇总 CSV')}</button>}
            {chartSvg && (
              <>
                <button
                  type="button"
                  onClick={() => downloadText(chartSvg, `pathology-chart-${dateStamp()}.svg`, 'image/svg+xml')}
                >
                  {t("图表 SVG")}</button>
                <button
                  type="button"
                  onClick={() => {
                    void svgToPngBlob(chartSvg).then((blob) => {
                      downloadBlob(blob, `pathology-chart-${dateStamp()}.png`);
                      onStatus('已导出图表 PNG', 'ok');
                    });
                  }}
                >
                  {t("图表 PNG")}</button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const text = `${generateMethodsZh(project, analysisResult, metric)}\n\n${generateMethodsEn(project, analysisResult, metric)}`;
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
              {t("复制 Methods")}</button>
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
