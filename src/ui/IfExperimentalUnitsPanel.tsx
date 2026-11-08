import { t } from '../i18n.ts';
import { ifSampleStatistics, type IfExperimentalDesign, type IfMetricKey } from '../core/if-statistics.ts';
import { downloadText, ifUnitMetricsCsv } from '../core/export.ts';
import { formatP } from '../core/stats.ts';
import type { IfSampleRecord, ProjectState } from '../core/types.ts';

const labels: Record<IfMetricKey, string> = {
  pearsonAll: '全像素 Pearson', pearsonMasked: '掩膜 Pearson', mandersM1: 'Manders M1', mandersM2: 'Manders M2',
};
const numberText = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(6) : '—';

export default function IfExperimentalUnitsPanel({ project, disabled, onDesign, onUpdate }: {
  project: ProjectState;
  disabled: boolean;
  onDesign: (design: IfExperimentalDesign) => void;
  onUpdate: (id: string, patch: Partial<Pick<IfSampleRecord, 'name' | 'group' | 'excludedFromStatistics'>>) => void;
}) {
  const records = project.ifSamples ?? [];
  const savedAssignments = project.ifExperimentalDesign?.assignments ?? [];
  const assignments = records.map((sample) => savedAssignments.find((a) => a.sampleId === sample.id) ?? {
    sampleId: sample.id, sourceId: sample.sourceId === 'unknown' ? '' : sample.sourceId,
    unitId: '', sectionId: '', fieldId: '', group: sample.group, roiIds: [],
  });
  // Keep conflicting/stale declarations visible to the validator. Opening or
  // confirming the UI must not repair an imported design by taking its first row.
  assignments.push(...savedAssignments.filter((a, index) => !records.some((r) => r.id === a.sampleId) || savedAssignments.findIndex((other) => other.sampleId === a.sampleId) !== index));
  const draft: IfExperimentalDesign = project.ifExperimentalDesign ?? {
    kind: 'independent', confirmed: false, controlGroup: '', aggregation: 'equal_sections',
    metric: 'pearsonMasked', regionMode: 'whole_image', assignments,
  };
  const groups = [...new Set(records.filter((r) => !r.excludedFromStatistics).map((r) => r.group))];
  const stats = ifSampleStatistics(records, project.ifExperimentalDesign);
  const candidate = ifSampleStatistics(records, { ...draft, assignments, confirmed: true });
  const canConfirm = records.some((r) => !r.excludedFromStatistics) && candidate.aggregation.designStatus === 'confirmed';
  const update = (patch: Partial<IfExperimentalDesign>) => onDesign({ ...draft, assignments, ...patch, confirmed: false });
  const edit = (sampleId: string, patch: Partial<IfExperimentalDesign['assignments'][number]>) => update({
    assignments: assignments.map((a) => a.sampleId === sampleId ? { ...a, ...patch } : a),
  });
  const testRows = [stats.report.omnibusParametric, stats.report.omnibusNonParametric].filter((row) => row !== null);
  return <section className="if-unit-design" aria-label={t('IF 实验单位与统计')}>
    <h4>{t('IF 实验单位与统计')}</h4>
    <p className="panel-note">{t('请按真实实验填写单位、切片和视野；独立性、采集可比性及选区方案由实验者核对。先确定分析方案，再查看组间结果。')}</p>
    <label>{t('IF 比较指标')}<select aria-label={t('IF 比较指标')} value={draft.metric} disabled={disabled} onChange={(e) => update({ metric: e.target.value as IfMetricKey })}>
      {Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}
    </select></label>
    <label>{t('IF 区域汇总')}<select aria-label={t('IF 区域汇总')} value={draft.regionMode} disabled={disabled}
      onChange={(e) => update({ regionMode: e.target.value as IfExperimentalDesign['regionMode'], assignments: assignments.map((a) => ({ ...a, roiIds: [] })) })}>
      <option value="whole_image">{t('每视野整图系数')}</option><option value="equal_rois">{t('每视野所选 ROI 系数等权均值')}</option>
    </select></label>
    <label>{t('实验设计')}<select aria-label={t('IF 实验设计')} value={draft.kind} disabled={disabled} onChange={(e) => update({ kind: e.target.value as IfExperimentalDesign['kind'] })}>
      <option value="independent">{t('独立组设计')}</option><option value="paired">{t('配对设计（仅描述）')}</option><option value="repeated">{t('重复测量设计（仅描述）')}</option>
    </select></label>
    <label>{t('统计对照组')}<select aria-label={t('IF 统计对照组')} value={draft.controlGroup} disabled={disabled} onChange={(e) => update({ controlGroup: e.target.value })}>
      <option value="">{t('请选择组别')}</option>{groups.map((g) => <option key={g}>{g}</option>)}
    </select></label>
    <p className="panel-note">{t('ROI 模式先对所选不重叠区域的系数取算术均值；大小区域等权。随后去重视野、切片内视野等权、单位内切片等权。它不是合并像素后的系数，也不做 Fisher z 变换。')}</p>
    <p className="panel-note">{t('任一所选区域指标未定义时，该视野和所属单位的当前指标留空，不重新分配权重。ROI、图像和重复记录数均不是 nBio。')}</p>
    <div className="unit-assignment-list">{records.map((sample, index) => {
      const a = assignments[index];
      return <details className="unit-assignment" key={sample.id}>
        <summary>{sample.name} · {sample.group}</summary>
        <label className="unit-inclusion"><input type="checkbox" aria-label={`${t('IF 纳入比较')} ${sample.id}`} checked={!sample.excludedFromStatistics} disabled={disabled}
          onChange={(e) => onUpdate(sample.id, { excludedFromStatistics: !e.target.checked })} />{t('纳入当前比较')}</label>
        <div className="unit-assignment-fields">
          <label>{t('分组')}<input aria-label={`${t('IF 统计分组')} ${sample.id}`} value={sample.group} disabled={disabled} onChange={(e) => onUpdate(sample.id, { group: e.target.value })} /></label>
          <label>{t('独立单位 ID')}<input aria-label={`${t('IF 独立单位 ID')} ${sample.id}`} value={a.unitId} disabled={disabled} onChange={(e) => edit(sample.id, { unitId: e.target.value })} /></label>
          <label>{t('切片 ID')}<input aria-label={`${t('IF 切片 ID')} ${sample.id}`} value={a.sectionId} disabled={disabled} onChange={(e) => edit(sample.id, { sectionId: e.target.value })} /></label>
          <label>{t('视野 ID')}<input aria-label={`${t('IF 视野 ID')} ${sample.id}`} value={a.fieldId} disabled={disabled} onChange={(e) => edit(sample.id, { fieldId: e.target.value })} /></label>
        </div>
        <label>{t('来源 ID')}<input aria-label={`${t('IF 来源 ID')} ${sample.id}`} value={a.sourceId} readOnly={Boolean(sample.sourceId && sample.sourceId !== 'unknown')} disabled={disabled} onChange={(e) => edit(sample.id, { sourceId: e.target.value })} /></label>
        {draft.regionMode === 'equal_rois' && <fieldset className="if-roi-selection"><legend>{t('纳入该视野的 ROI')}</legend>
          {sample.analysis.perRoi.length === 0 && <p>{t('此记录没有 ROI；请使用整图模式或重新保存含 ROI 的结果。')}</p>}
          {sample.analysis.perRoi.map((roi) => <label key={roi.roiId}><input type="checkbox" disabled={disabled} aria-label={`${t('IF 选区')} ${sample.id} ${roi.roiId}`} checked={a.roiIds.includes(roi.roiId!)}
            onChange={(e) => edit(sample.id, { roiIds: e.target.checked ? [...a.roiIds, roi.roiId!] : a.roiIds.filter((id) => id !== roi.roiId) })} />{roi.roiName} ({roi.rect.x},{roi.rect.y}; {roi.rect.w}×{roi.rect.h})</label>)}
        </fieldset>}
      </details>;
    })}</div>
    <label className="unit-confirmation"><input type="checkbox" aria-label={t('我已核对 IF 独立单位、选区方案与采集可比性')} checked={draft.confirmed} disabled={disabled || (!draft.confirmed && !canConfirm)}
      onChange={(e) => onDesign({ ...draft, assignments, confirmed: e.target.checked })} />{t('我已核对 IF 独立单位、选区方案与采集可比性')}</label>
    {!draft.confirmed && !canConfirm && candidate.aggregation.issues.length > 0 && <details><summary>{t('查看尚未满足的设计条件')}</summary><ul>{candidate.aggregation.issues.map((issue, i) => <li key={i}>{t(issue.message)}{issue.sampleIds?.length ? ` (${issue.sampleIds.join(', ')})` : ''}</li>)}</ul></details>}
    <section aria-label={t('IF 单位汇总')} className="unit-summary">
      <h4>{t('IF 单位汇总')}</h4>
      <p>{t(stats.aggregation.designStatus === 'confirmed' ? '已确认独立组设计；统计以单位均值为输入。' : '当前仅描述原始记录；实验设计未确认、无效或暂不支持。')}</p>
      <ul>{[...stats.aggregation.issues, ...stats.report.issues].map((issue, i) => <li key={i}>{t(issue.message)}{issue.sampleIds?.length ? ` (${issue.sampleIds.join(', ')})` : ''}</li>)}</ul>
      <div className="unit-table-wrap"><table className="result-table"><thead><tr><th>{t('分组')}</th><th>nRecords</th><th>nImages</th><th>nRegions</th><th>nFields</th><th>nBio</th><th>{t('单位均值')}</th><th>SD</th></tr></thead><tbody>
        {stats.groupCounts.map((row) => { const index = stats.report.groupNames.indexOf(row.group); return <tr key={row.group}><td>{row.group}</td><td>{row.nRecords}</td><td>{row.nImages ?? '—'}</td><td>{row.nRegions ?? '—'}</td><td>{row.nFields ?? '—'}</td><td>{row.nBio ?? '—'}</td>
          <td>{stats.aggregation.measurementLevel === 'biological_unit' ? numberText(stats.report.means[index]) : '—'}</td><td>{(row.nBio ?? 0) > 1 ? numberText(stats.report.sds[index]) : '—'}</td></tr>; })}
      </tbody></table></div>
      {stats.aggregation.units.length > 0 && <div className="unit-table-wrap"><table className="result-table"><thead><tr><th>{t('独立单位 ID')}</th><th>{t('分组')}</th><th>{t('切片数')}</th><th>nFields</th><th>nRegions</th><th>{t('单位均值')}</th></tr></thead><tbody>
        {stats.aggregation.units.map((unit) => <tr key={unit.unitId}><td>{unit.unitId}</td><td>{unit.group}</td><td>{unit.nSections}</td><td>{unit.nFields}</td><td>{unit.nRegions}</td><td>{numberText(unit.value)}</td></tr>)}
      </tbody></table></div>}
      {stats.inference && <div className="unit-table-wrap"><table className="result-table if-unit-tests"><thead><tr><th>{t('检验')}</th><th>{t('统计量')}</th><th>p</th><th>{t('校正 p')}</th></tr></thead><tbody>
        {testRows.map((row) => <tr key={row.label}><td>{t(row.label)}</td><td>{numberText(row.statistic)}</td><td>{formatP(row.p)}</td><td>—</td></tr>)}
        {stats.report.pairwise.map((row, i) => <tr key={i}><td>{row.label} ({row.method})</td><td>—</td><td>{formatP(row.p)}</td><td>{formatP(row.adjustedP)}</td></tr>)}
      </tbody></table></div>}
      <p className="panel-note">{t(stats.report.recommendation)}</p>
      <p className="panel-note">{t('每组至少两个有效单位只是程序门槛，不代表功效或分布假设充分；有界系数、小样本和边界值需按预定统计方案解释。')}</p>
      <button type="button" onClick={() => downloadText(ifUnitMetricsCsv(project), 'pathology-if-units.csv', 'text/csv;charset=utf-8')}>{t('导出 IF 单位 CSV')}</button>
    </section>
  </section>;
}
