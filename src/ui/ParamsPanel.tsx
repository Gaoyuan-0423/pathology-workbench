import type { ThresholdConfig } from '../core/types.ts';

interface ParamsPanelProps {
  threshold: ThresholdConfig;
  disabled: boolean;
  onChange: (patch: Partial<ThresholdConfig>) => void;
  showOverlay: boolean;
  onShowOverlayChange: (value: boolean) => void;
}

const METHODS: Array<{ id: ThresholdConfig['method']; label: string }> = [
  { id: 'otsu', label: 'Otsu（类间方差）' },
  { id: 'triangle', label: 'Triangle（峰谷距）' },
  { id: 'mean_sd', label: '均值 + 2σ' },
  { id: 'kapur', label: 'Kapur 最大熵' },
];

export default function ParamsPanel({
  threshold,
  disabled,
  onChange,
  showOverlay,
  onShowOverlayChange,
}: ParamsPanelProps) {
  return (
    <section className="panel">
      <h3>阈值与背景</h3>
      <div className="field-row">
        <label>阈值模式</label>
        <div className="segmented">
          {(
            [
              ['auto', '逐图自动'],
              ['manual', '手动'],
              ['control', '对照片'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              className={threshold.mode === mode ? 'segment-active' : ''}
              onClick={() => onChange({ mode })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {threshold.mode === 'auto' && (
        <div className="field-row">
          <label>自动方法</label>
          <select
            value={threshold.method}
            disabled={disabled}
            onChange={(event) => onChange({ method: event.target.value as ThresholdConfig['method'] })}
          >
            {METHODS.map((method) => (
              <option key={method.id} value={method.id}>{method.label}</option>
            ))}
          </select>
        </div>
      )}

      {threshold.mode === 'manual' && (
        <div className="field-row">
          <label>阈值（OD 0–255）</label>
          <input
            type="range"
            min={0}
            max={255}
            value={threshold.manualValue}
            disabled={disabled}
            onChange={(event) => onChange({ manualValue: Number(event.target.value) })}
          />
          <span className="field-value">{threshold.manualValue}</span>
        </div>
      )}

      {threshold.mode === 'control' && (
        <p className="panel-note">
          对照片标定（按假阳率反推阈值）将在下一步开放；当前未标定时回落为 Otsu。
        </p>
      )}

      <div className="field-row">
        <label>背景百分位</label>
        <input
          type="number"
          min={0}
          max={25}
          step={1}
          value={threshold.backgroundPercentile}
          disabled={disabled}
          onChange={(event) =>
            onChange({ backgroundPercentile: Math.min(25, Math.max(0, Number(event.target.value) || 0)) })
          }
        />
        <span className="field-value">%</span>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={(event) => onShowOverlayChange(event.target.checked)}
        />
        显示阳性叠加层
      </label>
    </section>
  );
}
