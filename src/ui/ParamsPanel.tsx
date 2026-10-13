import { useRef } from 'react';
import type { SegmentationConfig, ThresholdConfig } from '../core/types.ts';

interface ParamsPanelProps {
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  disabled: boolean;
  onThresholdChange: (patch: Partial<ThresholdConfig>) => void;
  onSegmentationChange: (patch: Partial<SegmentationConfig>) => void;
  /** 对照片标定：解码对照图并按假阳率反推阈值（主线程一次性计算） */
  onCalibrateControl: (file: File) => void;
  calibrating: boolean;
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
  segmentation,
  disabled,
  onThresholdChange,
  onSegmentationChange,
  onCalibrateControl,
  calibrating,
  showOverlay,
  onShowOverlayChange,
}: ParamsPanelProps) {
  const controlInputRef = useRef<HTMLInputElement>(null);

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
              onClick={() => onThresholdChange({ mode })}
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
            onChange={(event) =>
              onThresholdChange({ method: event.target.value as ThresholdConfig['method'] })
            }
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
            onChange={(event) => onThresholdChange({ manualValue: Number(event.target.value) })}
          />
          <span className="field-value">{threshold.manualValue}</span>
        </div>
      )}

      {threshold.mode === 'control' && (
        <div className="control-block">
          <input
            ref={controlInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.tif,.tiff"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onCalibrateControl(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={disabled || calibrating}
            onClick={() => controlInputRef.current?.click()}
          >
            {calibrating ? '标定中…' : '导入对照片并标定'}
          </button>
          {threshold.controlThreshold !== null && (
            <p className="panel-note">
              已标定：阈值 {threshold.controlThreshold}（来自 {threshold.controlImageName}）
              <button type="button" className="link-button" onClick={() => onThresholdChange({ controlThreshold: null, controlImageName: null })}>
                清除
              </button>
            </p>
          )}
          <div className="field-row">
            <label>允许假阳率</label>
            <input
              type="number"
              min={0}
              max={0.2}
              step={0.001}
              value={threshold.controlFalsePositiveRate}
              disabled={disabled}
              onChange={(event) =>
                onThresholdChange({
                  controlFalsePositiveRate: Math.min(0.2, Math.max(0, Number(event.target.value) || 0)),
                })
              }
            />
          </div>
          <p className="panel-note">阈值取对照分布的 (1−假阳率) 分位；标定后对所有图像统一使用。</p>
        </div>
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
            onThresholdChange({ backgroundPercentile: Math.min(25, Math.max(0, Number(event.target.value) || 0)) })
          }
        />
        <span className="field-value">%</span>
      </div>

      <h3>细胞核分割门控</h3>
      <div className="field-row">
        <label>最小面积 px</label>
        <input
          type="number"
          min={1}
          max={10000}
          value={segmentation.minAreaPx}
          disabled={disabled}
          onChange={(event) =>
            onSegmentationChange({ minAreaPx: Math.max(1, Math.round(Number(event.target.value) || 1)) })
          }
        />
      </div>
      <div className="field-row">
        <label>最大面积 px</label>
        <input
          type="number"
          min={4}
          max={200000}
          value={segmentation.maxAreaPx}
          disabled={disabled}
          onChange={(event) =>
            onSegmentationChange({ maxAreaPx: Math.max(4, Math.round(Number(event.target.value) || 4)) })
          }
        />
      </div>
      <div className="field-row">
        <label>最小圆度</label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={segmentation.minCircularity}
          disabled={disabled}
          onChange={(event) =>
            onSegmentationChange({ minCircularity: Math.min(1, Math.max(0, Number(event.target.value) || 0)) })
          }
        />
      </div>
      <p className="panel-note">
        核由苏木精通道逐图 Otsu 分割；圆度按 4 邻域边界周长定义（4πA/P²，偏低估）。
      </p>

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
