import type { ColocConfig } from '../core/types.ts';

interface ColocPanelProps {
  coloc: ColocConfig;
  disabled: boolean;
  onChange: (patch: Partial<ColocConfig>) => void;
  showOverlay: boolean;
  onShowOverlayChange: (value: boolean) => void;
}

const CHANNEL_LABELS: Record<0 | 1 | 2, string> = { 0: '红 (R)', 1: '绿 (G)', 2: '蓝 (B)' };

export default function ColocPanel({
  coloc,
  disabled,
  onChange,
  showOverlay,
  onShowOverlayChange,
}: ColocPanelProps) {
  return (
    <section className="panel">
      <h3>共定位参数</h3>
      <div className="field-row">
        <label>通道 A</label>
        <select
          value={coloc.channelA}
          disabled={disabled}
          onChange={(event) => onChange({ channelA: Number(event.target.value) as 0 | 1 | 2 })}
        >
          {([0, 1, 2] as const).map((channel) => (
            <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label>通道 B</label>
        <select
          value={coloc.channelB}
          disabled={disabled}
          onChange={(event) => onChange({ channelB: Number(event.target.value) as 0 | 1 | 2 })}
        >
          {([0, 1, 2] as const).map((channel) => (
            <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label>阈值模式</label>
        <div className="segmented">
          {(
            [
              ['auto', '逐图 Otsu'],
              ['manual', '手动'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              className={coloc.thresholdMode === mode ? 'segment-active' : ''}
              onClick={() => onChange({ thresholdMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {coloc.thresholdMode === 'manual' && (
        <>
          <div className="field-row">
            <label>通道 A 阈值</label>
            <input
              type="range"
              min={0}
              max={255}
              value={coloc.manualA}
              disabled={disabled}
              onChange={(event) => onChange({ manualA: Number(event.target.value) })}
            />
            <span className="field-value">{coloc.manualA}</span>
          </div>
          <div className="field-row">
            <label>通道 B 阈值</label>
            <input
              type="range"
              min={0}
              max={255}
              value={coloc.manualB}
              disabled={disabled}
              onChange={(event) => onChange({ manualB: Number(event.target.value) })}
            />
            <span className="field-value">{coloc.manualB}</span>
          </div>
        </>
      )}

      <div className="field-row">
        <label>背景百分位</label>
        <input
          type="number"
          min={0}
          max={25}
          step={1}
          value={coloc.backgroundPercentile}
          disabled={disabled}
          onChange={(event) =>
            onChange({ backgroundPercentile: Math.min(25, Math.max(0, Number(event.target.value) || 0)) })
          }
        />
        <span className="field-value">%</span>
      </div>

      <p className="panel-note">
        逐通道扣除背景百分位后，主指标为掩膜 Pearson（任一通道超阈的像素集合）；
        Manders M1 = A 在 B 阳性区强度占比，M2 对称。全像素 Pearson 一并列出作参考。
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={(event) => onShowOverlayChange(event.target.checked)}
        />
        显示通道掩膜叠加（A 品红 / B 绿 / 重叠白）
      </label>
    </section>
  );
}
