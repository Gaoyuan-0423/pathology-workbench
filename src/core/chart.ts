/**
 * 手写 SVG 柱状图：组均值 ± 标准差 + 首组 vs 其余组的显著性星标。
 */
import { significanceStars } from './stats.ts';
import { t } from '../i18n.ts';
import type { GroupStatsReport } from './analysis/statistics.ts';

export interface BarChartOptions {
  yLabel: string;
  title: string;
  width?: number;
  height?: number;
}

export function groupBarChartSvg(report: GroupStatsReport, options: BarChartOptions): string {
  const width = options.width ?? 560;
  const height = options.height ?? 360;
  const margin = { top: 40, right: 24, bottom: 64, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const means = report.means;
  const sds = report.sds.map((value) => (Number.isFinite(value) ? value : 0));
  const maxY = Math.max(1e-9, ...means.map((m, i) => m + sds[i])) * 1.25;
  const bandWidth = plotW / Math.max(1, report.groupNames.length);
  const barWidth = bandWidth * 0.55;

  const yScale = (value: number) => margin.top + plotH - (value / maxY) * plotH;

  const bars = report.groupNames
    .map((name, index) => {
      const x = margin.left + index * bandWidth + (bandWidth - barWidth) / 2;
      const yTop = yScale(means[index] + sds[index]);
      const yMean = yScale(means[index]);
      const yBottom = yScale(Math.max(0, means[index] - sds[index]));
      const cap = 8;
      return `
    <rect x="${x.toFixed(1)}" y="${yMean.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, margin.top + plotH - yMean).toFixed(1)}" fill="${index === 0 ? '#94a3b8' : '#7c3aed'}" stroke="#334155" stroke-width="1"/>
    <line x1="${(x + barWidth / 2).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(x + barWidth / 2).toFixed(1)}" y2="${yBottom.toFixed(1)}" stroke="#334155" stroke-width="1.4"/>
    <line x1="${(x + barWidth / 2 - cap / 2).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(x + barWidth / 2 + cap / 2).toFixed(1)}" y2="${yTop.toFixed(1)}" stroke="#334155" stroke-width="1.4"/>
    <line x1="${(x + barWidth / 2 - cap / 2).toFixed(1)}" y1="${yBottom.toFixed(1)}" x2="${(x + barWidth / 2 + cap / 2).toFixed(1)}" y2="${yBottom.toFixed(1)}" stroke="#334155" stroke-width="1.4"/>
    <text x="${(x + barWidth / 2).toFixed(1)}" y="${(height - margin.bottom + 18).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1e293b">${escapeXml(name)} (n=${report.ns[index]})</text>`;
    })
    .join('');

  // 显著性标注：从 pairwise 中取 vs 首组的比较
  const brackets = report.pairwise
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.label.includes(`vs ${report.groupNames[0]}`) || row.label.endsWith(`vs ${report.groupNames[0]}`))
    .slice(0, 4)
    .map(({ row, index }, slot) => {
      const targetIndex = index + 1;
      if (targetIndex >= report.groupNames.length) return '';
      const x1 = margin.left + slot * 0 + margin.left + bandWidth * targetIndex + bandWidth / 2;
      const y = margin.top - 10 - slot * 18;
      const leftX = margin.left + bandWidth * 0 + bandWidth / 2;
      const stars = significanceStars(row.adjustedP);
      return `
    <line x1="${leftX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>
    <line x1="${leftX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${leftX.toFixed(1)}" y2="${(y + 5).toFixed(1)}" stroke="#1e293b" stroke-width="1"/>
    <line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y + 5).toFixed(1)}" stroke="#1e293b" stroke-width="1"/>
    <text x="${((leftX + x1) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1e293b">${stars}</text>`;
    })
    .join('');

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = (maxY / yTicks) * i;
    return `
    <line x1="${margin.left}" y1="${yScale(value).toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${yScale(value).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
    <text x="${(margin.left - 8).toFixed(1)}" y="${(yScale(value) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#64748b">${formatTick(value)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${(width / 2).toFixed(1)}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#1e293b">${escapeXml(options.title)}</text>
  ${ticks}
  <line x1="${margin.left}" y1="${(margin.top + plotH).toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${(margin.top + plotH).toFixed(1)}" stroke="#334155" stroke-width="1.2"/>
  ${bars}
  ${brackets}
  <text x="14" y="${(margin.top + plotH / 2).toFixed(1)}" font-size="12" fill="#334155" transform="rotate(-90 14 ${(margin.top + plotH / 2).toFixed(1)})" text-anchor="middle">${escapeXml(options.yLabel)}${t("（均值 ± SD）")}</text>
</svg>`;
}

function formatTick(value: number): string {
  if (value >= 100) return Math.round(value).toString();
  return Number(value.toFixed(2)).toString();
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}
