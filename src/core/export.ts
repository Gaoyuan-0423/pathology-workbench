import { t } from '../i18n.ts';
/**
 * 导出：Excel（多工作表）/ CSV / 图表 SVG·PNG / 叠加层 PNG / Methods 文本。
 * Excel 走 SheetJS；CSV 手写 RFC 4180 + UTF-8 BOM（与 pcr-workbench 同款）。
 */
import * as XLSX from 'xlsx';
import type { GroupStatsReport } from './analysis/statistics.ts';
import { significanceStars } from './stats.ts';
import type { AnalysisResult, ProjectState, RoiMetrics, SampleRecord } from './types.ts';
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

export function buildWorkbook(
  samples: SampleRecord[],
  report: GroupStatsReport | null,
  project: ProjectState,
  result: AnalysisResult | null,
): XLSX.WorkBook {
  const book = XLSX.utils.book_new();

  const metricsAoa: (string | number | null)[][] = [
    [t('样本'), t('分组'), t('图像'), t('阳性面积'), t('阳性核'), t('总核'), t('标注指数'), t('H-score'), t('触边核'), t('折算总数'), 'IOD', t('平均OD'), t('密度(个/mm²)')],
    ...samples.map((sample) => [
      sample.name,
      sample.group,
      sample.imageName,
      round4(sample.metrics.positiveFraction),
      sample.metrics.positiveNuclei,
      sample.metrics.totalNuclei,
      round4(sample.metrics.labelingIndex),
      sample.metrics.hScore === null ? null : round4(sample.metrics.hScore),
      sample.metrics.borderNuclei,
      sample.metrics.estimatedTotalCount,
      sample.metrics.integratedOpticalDensity,
      round4(sample.metrics.meanOpticalDensity),
      sample.metrics.densityPerMm2 === null ? null : round4(sample.metrics.densityPerMm2),
    ]),
  ];
  XLSX.utils.book_append_sheet(book, aoaToSheet(metricsAoa), t('样本指标'));

  if (report) {
    const statsAoa: (string | number | null)[][] = [
      [t('检验'), t('统计量'), 'df1', 'df2', 'p', t('校正p'), t('显著性')],
      ...(report.omnibusParametric
        ? [[
            t(report.omnibusParametric.label),
            round4(report.omnibusParametric.statistic),
            report.omnibusParametric.df1 ?? '',
            report.omnibusParametric.df2 === null ? '' : round4(report.omnibusParametric.df2),
            round4(report.omnibusParametric.p),
            '—',
            significanceStars(report.omnibusParametric.p),
          ]]
        : []),
      ...(report.omnibusNonParametric
        ? [[
            t(report.omnibusNonParametric.label),
            round4(report.omnibusNonParametric.statistic),
            report.omnibusNonParametric.df1 ?? '',
            '',
            round4(report.omnibusNonParametric.p),
            '—',
            significanceStars(report.omnibusNonParametric.p),
          ]]
        : []),
      ...report.pairwise.map((row) => [
        row.label,
        '',
        '',
        '',
        round4(row.p),
        round4(row.adjustedP),
        significanceStars(row.adjustedP),
      ]),
      [],
      [t('分组'), 'n', t('均值'), t('标准差'), t('中位数')],
      ...report.groupNames.map((name, index) => [
        name,
        report.ns[index],
        round4(report.means[index]),
        round4(report.sds[index]),
        round4(report.medians[index]),
      ]),
      [],
      [t('正态性 (D\'Agostino–Pearson)'), 'p'],
      ...report.normality.map((item) => [item.group, item.p === null ? t('n<8 未检验') : round4(item.p)]),
      [t('方差齐性 (Brown–Forsythe)'), round4(report.leveneP)],
      [],
      [t('建议'), t(report.recommendation)],
    ];
    XLSX.utils.book_append_sheet(book, aoaToSheet(statsAoa), t('统计检验'));
  }

  XLSX.utils.book_append_sheet(
    book,
    aoaToSheet([[t('Methods（中文）')], [generateMethodsZh(project, result)], [], ['Methods (English)'], [generateMethodsEn(project, result)]]),
    'Methods',
  );

  XLSX.utils.book_append_sheet(
    book,
    aoaToSheet([
      [t('项目'), t('值')],
      [t('软件'), 'Pathology Workbench v0.1'],
      [t('导出时间'), new Date().toISOString()],
      [t('染色预设'), project.profileId],
      [t('阈值模式'), project.threshold.mode],
      [t('自动方法'), project.threshold.method],
      [t('背景百分位'), project.threshold.backgroundPercentile],
      [t('对照片'), project.threshold.controlImageName ?? t('未标定')],
      [t('核面积门控 (px)'), `${project.segmentation.minAreaPx}–${project.segmentation.maxAreaPx}`],
      [t('最小圆度'), project.segmentation.minCircularity],
      ['μm/px', project.calibration.mpp ?? t('未标定')],
      [t('样本数'), samples.length],
    ]),
    t('项目信息'),
  );
  return book;
}

function round4(value: number | null): number | string {
  if (value === null || !Number.isFinite(value)) return '';
  return Math.round(value * 10000) / 10000;
}

export function exportWorkbook(
  samples: SampleRecord[],
  report: GroupStatsReport | null,
  project: ProjectState,
  result: AnalysisResult | null,
): void {
  const book = buildWorkbook(samples, report, project, result);
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `pathology-workbench-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function metricsCsv(samples: SampleRecord[]): string {
  const header = t('样本,分组,图像,阳性面积,阳性核,总核,标注指数,H-score,IOD,平均OD');
  const rows = samples.map((sample) =>
    [
      sample.name,
      sample.group,
      sample.imageName,
      sample.metrics.positiveFraction.toFixed(6),
      sample.metrics.positiveNuclei,
      sample.metrics.totalNuclei,
      sample.metrics.labelingIndex?.toFixed(6) ?? '',
      sample.metrics.hScore?.toFixed(4) ?? '',
      sample.metrics.integratedOpticalDensity,
      sample.metrics.meanOpticalDensity ?? '',
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(','),
  );
  return `\uFEFF${[header, ...rows].join('\n')}`;
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
