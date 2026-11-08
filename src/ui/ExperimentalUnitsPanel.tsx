import { t } from '../i18n';
import type { PathologyExperimentalDesign, ProjectState, SampleRecord } from '../core/types';

export default function ExperimentalUnitsPanel({ project, disabled, resolvingSources, onDesign, onSample, onResolveSources, onDeleteSample }: {
  project: ProjectState;
  disabled: boolean;
  resolvingSources: boolean;
  onDesign: (design: PathologyExperimentalDesign) => void;
  onSample: (id: string, patch: Partial<SampleRecord>) => void;
  onResolveSources: () => void;
  onDeleteSample: (id: string) => void;
}) {
  const assignments = project.samples.map((sample) => {
    const saved = project.experimentalDesign?.assignments.find((a) => a.sampleId === sample.id);
    return { sampleId: sample.id, sourceId: sample.sourceId ?? saved?.sourceId ?? '',
      unitId: saved?.unitId ?? '', sectionId: saved?.sectionId ?? '', fieldId: saved?.fieldId ?? '', group: sample.group };
  });
  const draft: PathologyExperimentalDesign = project.experimentalDesign ?? {
    kind: 'independent', confirmed: false, controlGroup: '', aggregation: 'equal_sections', assignments,
  };
  const included = assignments.filter((a) => !project.samples.find((s) => s.id === a.sampleId)?.excludedFromStatistics);
  const groups = [...new Set(included.map((a) => a.group.trim()).filter(Boolean))];
  const canConfirm = draft.kind === 'independent' && included.length > 0 && groups.length >= 2
    && groups.includes(draft.controlGroup) && included.every((a) => [a.sourceId, a.unitId, a.sectionId, a.fieldId, a.group].every((v) => v.trim()));
  function update(patch: Partial<PathologyExperimentalDesign>) {
    onDesign({ ...draft, assignments, ...patch, confirmed: false });
  }
  return <section className="unit-design" aria-label={t('实验单位与视野关系')}>
    <h4>{t('实验单位与视野关系')}</h4>
    <p className="panel-note">{t('独立单位由实验设计决定。请填写单位、切片和视野关系；图像数量不能代替独立样本量。')}</p>
    <label>{t('实验设计')}
      <select value={draft.kind} disabled={disabled} onChange={(e) => update({ kind: e.target.value as PathologyExperimentalDesign['kind'] })}>
        <option value="independent">{t('独立组设计')}</option><option value="paired">{t('配对设计（仅描述）')}</option><option value="repeated">{t('重复测量设计（仅描述）')}</option>
      </select>
    </label>
    <label>{t('统计对照组')}
      <select value={draft.controlGroup} disabled={disabled} onChange={(e) => update({ controlGroup: e.target.value })}>
        <option value="">{t('请选择组别')}</option>{groups.map((group) => <option key={group}>{group}</option>)}
      </select>
    </label>
    <p className="panel-note">{t('汇总规则：去重视野 → 切片内视野均值 → 单位内切片等权均值。组间统计每个单位贡献一个值；这不是合并全部像素或细胞后的比例。')}</p>
    <button type="button" disabled={disabled || resolvingSources} onClick={onResolveSources}>{t(resolvingSources ? '正在核对来源…' : '从已保存原图补全来源')}</button>
    <div className="unit-assignment-list">
      {project.samples.map((sample, index) => {
        const a = assignments[index];
        const edit = (field: 'sourceId' | 'unitId' | 'sectionId' | 'fieldId', value: string) => update({ assignments: assignments.map((item, i) => i === index ? { ...item, [field]: value } : item) });
        return <details className="unit-assignment" key={sample.id} open>
          <summary>{sample.name}</summary>
          <label className="unit-inclusion"><input type="checkbox" checked={!sample.excludedFromStatistics} disabled={disabled}
            onChange={(e) => onSample(sample.id, { excludedFromStatistics: !e.target.checked })} />{t('纳入当前比较')}</label>
          <span className="panel-note">{t('记录预设')}：{sample.profileId ?? t('未知')}</span>
          <div className="unit-assignment-fields">
            <label>{t('分组')}<input aria-label={`${t('分组')} ${sample.id}`} value={sample.group} disabled={disabled} onChange={(e) => onSample(sample.id, { group: e.target.value })} /></label>
            <label>{t('独立单位 ID')}<input aria-label={`${t('独立单位 ID')} ${sample.id}`} value={a.unitId} disabled={disabled} onChange={(e) => edit('unitId', e.target.value)} /></label>
            <label>{t('切片 ID')}<input aria-label={`${t('切片 ID')} ${sample.id}`} value={a.sectionId} disabled={disabled} onChange={(e) => edit('sectionId', e.target.value)} /></label>
            <label>{t('视野 ID')}<input aria-label={`${t('视野 ID')} ${sample.id}`} value={a.fieldId} disabled={disabled} onChange={(e) => edit('fieldId', e.target.value)} /></label>
          </div>
          <label>{t('来源 ID')}<input aria-label={`${t('来源 ID')} ${sample.id}`} value={a.sourceId} readOnly={Boolean(sample.sourceId)} disabled={disabled} onChange={(e) => edit('sourceId', e.target.value)} /></label>
          <button type="button" className="link-button" onClick={() => onDeleteSample(sample.id)} disabled={disabled}>{t('删除')}</button>
        </details>;
      })}
    </div>
    <p className="panel-note">{t('新记录的来源 ID 来自原文件内容。历史记录可补录明确的来源 ID；不同 ID 本身不证明独立性。未知或混合染色预设不能进入同一次推断。')}</p>
    <label className="unit-confirmation"><input type="checkbox" checked={draft.confirmed} disabled={disabled || (!canConfirm && !draft.confirmed)} onChange={(e) => onDesign({ ...draft,
      assignments: assignments.map((a) => ({ ...a, sourceId: a.sourceId.trim(), unitId: a.unitId.trim(), sectionId: a.sectionId.trim(), fieldId: a.fieldId.trim(), group: a.group.trim() })), confirmed: e.target.checked })} />
      {t('我已核对独立单位、切片、视野、同一指标定义与纳入记录，确认此独立组设计和等权规则。')}</label>
    <p className="panel-note">{t('修改关系、纳入记录或分组后需要重新确认。缺失指标的单位不进入当前指标的检验；原始记录始终保留。')}</p>
  </section>;
}
