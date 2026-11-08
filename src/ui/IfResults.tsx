import { t } from '../i18n.ts';
import type { IfAnalysisResult, IfRegionResult, IfUndefinedReason } from '../core/types.ts';

const reasons: Record<IfUndefinedReason, string> = {
  pearson_all_insufficient_pixels: '全区域 Pearson：像素不足 2 个。',
  pearson_all_zero_variance: '全区域 Pearson：至少一个通道的方差为零。',
  pearson_masked_insufficient_pixels: '掩膜 Pearson：有效像素不足 2 个。',
  pearson_masked_zero_variance: '掩膜 Pearson：至少一个通道的方差为零。',
  manders_m1_zero_denominator: 'Manders M1：区域内 A 通道总强度为零。',
  manders_m2_zero_denominator: 'Manders M2：区域内 B 通道总强度为零。',
};
const coefficient = (value: number | null) => value === null || !Number.isFinite(value) ? t('未定义') : value.toFixed(3);
const regionName = (region: IfRegionResult) => region.roiId === null ? t('整图') : region.roiName;

export default function IfResults({ analysis }: { analysis: IfAnalysisResult }) {
  const whole = analysis.overall;
  return <div className="if-results">
    <table className="result-table if-overall"><tbody>
      <tr><td>{t('掩膜 Pearson r（主指标）')}</td><td>{coefficient(whole.pearsonMasked)}</td></tr>
      <tr><td>{t('全像素 Pearson r（参考）')}</td><td>{coefficient(whole.pearsonAll)}</td></tr>
      <tr><td>{t('Manders M1（A 在 B 阳性区）')}</td><td>{coefficient(whole.mandersM1)}</td></tr>
      <tr><td>{t('Manders M2（B 在 A 阳性区）')}</td><td>{coefficient(whole.mandersM2)}</td></tr>
      <tr><td>{t('通道阈值 A / B')}</td><td>{whole.thresholdA} / {whole.thresholdB}</td></tr>
      <tr><td>{t('背景水平 A / B')}</td><td>{whole.backgroundA} / {whole.backgroundB}</td></tr>
      <tr><td>{t('区域像素 / 掩膜像素')}</td><td>{whole.pixelCount} / {whole.unionPixels}</td></tr>
    </tbody></table>
    {analysis.perRoi.length > 0 && <div className="unit-table-wrap">
      <table className="result-table if-roi-results" aria-label={t('IF 区域结果')}>
        <thead><tr><th>{t('区域')}</th><th>{t('像素数')}</th><th>{t('掩膜像素数')}</th><th>{t('Pearson（全区域）')}</th><th>{t('Pearson（掩膜）')}</th><th>M1</th><th>M2</th></tr></thead>
        <tbody>{analysis.perRoi.map((region) => <tr key={region.roiId}>
          <td>{region.roiName}</td><td>{region.pixelCount}</td><td>{region.unionPixels}</td>
          <td>{coefficient(region.pearsonAll)}</td><td>{coefficient(region.pearsonMasked)}</td><td>{coefficient(region.mandersM1)}</td><td>{coefficient(region.mandersM2)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {[whole, ...analysis.perRoi].filter((region) => region.undefinedReasons.length > 0).map((region) =>
      <div className="panel-note" key={region.roiId ?? 'whole'}><strong>{regionName(region)}</strong><ul>{region.undefinedReasons.map((reason) => <li key={reason}>{t(reasons[reason])}</li>)}</ul></div>)}
    <details className="if-measurement-details"><summary>{t('查看区域边界与掩膜计数')}</summary>
      <div className="unit-table-wrap"><table className="result-table"><thead><tr><th>{t('区域')}</th><th>x, y, w, h</th><th>A+</th><th>B+</th><th>A+ ∪ B+</th><th>A+ ∩ B+</th></tr></thead>
        <tbody>{[whole, ...analysis.perRoi].map((region) => <tr key={region.roiId ?? 'whole'}><td>{regionName(region)}</td><td>{[region.rect.x, region.rect.y, region.rect.w, region.rect.h].join(', ')}</td><td>{region.positivePixelsA}</td><td>{region.positivePixelsB}</td><td>{region.unionPixels}</td><td>{region.intersectionPixels}</td></tr>)}</tbody>
      </table></div>
    </details>
    <p className="panel-note">{t('背景与阈值在整图确定，再固定应用于各 ROI。掩膜为任一通道严格超阈的像素；Manders 分母为各区域对应通道的全部背景扣除后强度。')}</p>
    <p className="panel-note">{t('ROI 边界使用工作图像素坐标。像素数和 ROI 数不是独立生物学样本量。')}</p>
  </div>;
}
