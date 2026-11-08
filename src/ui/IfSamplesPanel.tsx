import { useState } from 'react';
import { t } from '../i18n.ts';
import { downloadText, ifMetricsCsv } from '../core/export.ts';
import type { AnalysisResult, IfSampleRecord, ProjectState } from '../core/types.ts';
import IfResults from './IfResults.tsx';
import IfExperimentalUnitsPanel from './IfExperimentalUnitsPanel.tsx';
import type { IfExperimentalDesign } from '../core/if-statistics.ts';

interface Props {
  project: ProjectState;
  result: AnalysisResult | null;
  saving: boolean;
  busy: boolean;
  onSave: (group: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<IfSampleRecord, 'name' | 'group' | 'excludedFromStatistics'>>) => void;
  onDesign: (design: IfExperimentalDesign) => void;
  onRestore: (id: string) => void;
  canRestore: (id: string) => boolean;
}
export default function IfSamplesPanel({ project, result, saving, busy, onSave, onDelete, onUpdate, onRestore, canRestore, onDesign }: Props) {
  const [group, setGroup] = useState('');
  const records = project.ifSamples ?? [];
  return <section className="panel" aria-label={t('IF 结果库')}>
    <h3>{t('IF 结果库')}</h3>
    <p className="panel-note">{t('每条记录保存整图和全部 ROI、通道配置及原图来源。分组标签用于整理；组间推断还需确认下方的 IF 实验单位和汇总方案。')}</p>
    <div className="field-row"><input aria-label={t('IF 分组标签')} placeholder={t('IF 分组标签')} value={group} onChange={(event) => setGroup(event.target.value)} />
      <button type="button" disabled={busy || saving || !result?.ifAnalysis || !group.trim()} onClick={() => onSave(group.trim())}>{t(saving ? '正在保存 IF 结果…' : '保存 IF 结果')}</button>
    </div>
    <p className="panel-note">{t('已保存 IF 记录数：')}{records.length}</p>
    <div className="if-record-list">{records.map((record) => <details className="unit-assignment if-record" key={record.id}>
      <summary>{record.name}</summary>
      <label>{t('记录名称')}<input aria-label={`${t('记录名称')} ${record.id}`} value={record.name} disabled={busy} onChange={(event) => onUpdate(record.id, { name: event.target.value, group: record.group })} /></label>
      <label>{t('分组')}<input aria-label={`${t('IF 分组标签')} ${record.id}`} value={record.group} disabled={busy} onChange={(event) => onUpdate(record.id, { name: record.name, group: event.target.value })} /></label>
      <p className="panel-note">{record.imageName} · {t('通道 A / B')}: {'RGB'[record.config.channelA]} / {'RGB'[record.config.channelB]} · ROI: {record.analysis.perRoi.length}</p>
      <p className="panel-note source-identity">{t('来源 ID')}: {record.sourceId}</p>
      <IfResults analysis={record.analysis} />
      <div className="export-buttons"><button type="button" disabled={busy || !canRestore(record.id)} onClick={() => onRestore(record.id)}>{t('载入此记录并复算')}</button>
        <button type="button" disabled={busy} onClick={() => onDelete(record.id)}>{t('删除记录')}</button></div>
    </details>)}</div>
    {(result?.ifAnalysis || records.length > 0) && <button type="button" onClick={() => downloadText(ifMetricsCsv(project, result), `pathology-if-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')}>{t('导出 IF CSV')}</button>}
    {records.length > 0 && <IfExperimentalUnitsPanel project={project} disabled={busy || saving} onDesign={onDesign} onUpdate={onUpdate} />}
  </section>;
}
