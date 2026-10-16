import { tError, t } from '../i18n.ts';
import type { AnalysisResult } from '../core/types.ts';

interface ResultsPanelProps {
  result: AnalysisResult | null;
  running: boolean;
  hasImage: boolean;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`;
}

export default function ResultsPanel({ result, running, hasImage }: ResultsPanelProps) {
  if (!hasImage || !result) return null;
  if (result.coloc) {
    return (
      <section className="panel">
        <h3>{t("共定位结果 ")}{running && <span className="running-badge">{t("分析中…")}</span>}</h3>
        <table className="result-table">
          <tbody>
            <tr><td>{t("掩膜 Pearson r（主指标）")}</td><td>{result.coloc.pearsonMasked.toFixed(3)}</td></tr>
            <tr><td>{t("全像素 Pearson r（参考）")}</td><td>{Number.isFinite(result.coloc.pearsonAll) ? result.coloc.pearsonAll.toFixed(3) : '—'}</td></tr>
            <tr><td>{t("Manders M1（A 在 B 阳性区）")}</td><td>{result.coloc.mandersM1.toFixed(3)}</td></tr>
            <tr><td>{t("Manders M2（B 在 A 阳性区）")}</td><td>{result.coloc.mandersM2.toFixed(3)}</td></tr>
            <tr><td>{t("通道阈值 A / B")}</td><td>{result.coloc.thresholdA} / {result.coloc.thresholdB}</td></tr>
            <tr><td>{t("背景水平 A / B")}</td><td>{result.coloc.backgroundA} / {result.coloc.backgroundB}</td></tr>
          </tbody>
        </table>
        <p className="panel-note">
          {t("Pearson 范围 −1…1；Manders 0…1。掩膜 = 任一通道超阈像素。")}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h3>{t("定量结果 ")}{running && <span className="running-badge">{t("分析中…")}</span>}</h3>
      {!result && !running && <p className="panel-note">{t("调整参数后自动分析。")}</p>}
      {result && (
        <>
          <table className="result-table">
            <thead>
              <tr>
                <th>{t("区域")}</th>
                <th>{t("阳性面积")}</th>
                <th>{t("阳性核/总核")}</th>
                <th>{t("标注指数")}</th>
                <th>IOD</th>
                <th>{t("平均 OD")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="result-overall">
                <td>{t("整图")}</td>
                <td>{pct(result.overall.positiveFraction)}</td>
                <td>{result.overall.positiveNuclei}/{result.overall.totalNuclei}</td>
                <td>{pct(result.overall.labelingIndex)}</td>
                <td>{result.overall.integratedOpticalDensity}</td>
                <td>{result.overall.meanOpticalDensity ?? '—'}</td>
              </tr>
              {result.perRoi.map((roi) => (
                <tr key={roi.roiId}>
                  <td>{roi.roiName}</td>
                  <td>{pct(roi.positiveFraction)}</td>
                  <td>{roi.positiveNuclei}/{roi.totalNuclei}</td>
                  <td>{pct(roi.labelingIndex)}</td>
                  <td>{roi.integratedOpticalDensity}</td>
                  <td>{roi.meanOpticalDensity ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.overall.densityPerMm2 !== null && (
            <p className="panel-note">
              {t("细胞密度（整图折算）：")}{result.overall.densityPerMm2.toFixed(1)} {t("个/mm²；触边核 ")}{result.overall.borderNuclei} {t("个")}</p>
          )}
          <p className="panel-note">
            {t("阈值 ")}{result.thresholdUsed}{t("（OD 0–255）· 背景水平 ")}{result.backgroundLevel}
            {result.warnings.map((warning) => ` · ${tError(warning)}`)}
          </p>
        </>
      )}
    </section>
  );
}
