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
  if (!hasImage) return null;
  return (
    <section className="panel">
      <h3>定量结果 {running && <span className="running-badge">分析中…</span>}</h3>
      {!result && !running && <p className="panel-note">调整参数后自动分析。</p>}
      {result && (
        <>
          <table className="result-table">
            <thead>
              <tr>
                <th>区域</th>
                <th>阳性面积</th>
                <th>IOD</th>
                <th>平均 OD</th>
              </tr>
            </thead>
            <tbody>
              <tr className="result-overall">
                <td>整图</td>
                <td>{pct(result.overall.positiveFraction)}</td>
                <td>{result.overall.integratedOpticalDensity}</td>
                <td>{result.overall.meanOpticalDensity ?? '—'}</td>
              </tr>
              {result.perRoi.map((roi) => (
                <tr key={roi.roiId}>
                  <td>{roi.roiName}</td>
                  <td>{pct(roi.positiveFraction)}</td>
                  <td>{roi.integratedOpticalDensity}</td>
                  <td>{roi.meanOpticalDensity ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel-note">
            阈值 {result.thresholdUsed}（OD 0–255）· 背景水平 {result.backgroundLevel}
            {result.warnings.map((warning) => ` · ${warning}`)}
          </p>
        </>
      )}
    </section>
  );
}
