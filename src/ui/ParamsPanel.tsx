import { t } from '../i18n.ts';
import { useId, useRef } from 'react';
import type { SegmentationConfig, ThresholdConfig, Vec3 } from '../core/types.ts';

interface ParamsPanelProps {
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  /** 非核计数场景默认收起分割设置，保留原有参数与计算行为。 */
  collapseSegmentation?: boolean;
  /** 当前预设的定量通道名（DAB/伊红/苯胺蓝） */
  quantifyLabel: string;
  disabled: boolean;
  onThresholdChange: (patch: Partial<ThresholdConfig>) => void;
  onSegmentationChange: (patch: Partial<SegmentationConfig>) => void;
  /** 对照片标定：解码对照图并按假阳率反推阈值（主线程一次性计算） */
  onCalibrateControl: (file: File) => void;
  calibrating: boolean;
  showOverlay: boolean;
  onShowOverlayChange: (value: boolean) => void;
  /** 当前生效向量（自定义或预设）与预设向量 */
  stainVectors: [Vec3, Vec3] | null;
  presetVectors: [Vec3, Vec3] | null;
  onVectorsChange: (pair: [Vec3, Vec3] | null) => void;
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
  collapseSegmentation = false,
  quantifyLabel,
  stainVectors,
  presetVectors,
  onVectorsChange,
  disabled,
  onThresholdChange,
  onSegmentationChange,
  onCalibrateControl,
  calibrating,
  showOverlay,
  onShowOverlayChange,
}: ParamsPanelProps) {
  const controlInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const segmentationFields = (
    <>
      <div className="field-row">
        <label htmlFor={`${formId}-min-area`}>{t("最小面积 px")}</label>
        <input
          id={`${formId}-min-area`}
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
        <label htmlFor={`${formId}-max-area`}>{t("最大面积 px")}</label>
        <input
          id={`${formId}-max-area`}
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
        <label htmlFor={`${formId}-circularity`}>{t("最小圆度")}</label>
        <input
          id={`${formId}-circularity`}
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
        {t("核由苏木精通道逐图 Otsu 分割；圆度按 4 邻域边界周长定义（4πA/P²，偏低估）。")}</p>
    </>
  );

  return (
    <section className="panel" aria-label={t("染色定量参数")}>
      <h3>{quantifyLabel} {t("阈值与背景")}</h3>
      <div className="field-row">
        <span id={`${formId}-threshold-mode`} className="field-label">{t("阈值模式")}</span>
        <div className="segmented" role="group" aria-labelledby={`${formId}-threshold-mode`}>
          {(
            [
              ['auto', t('逐图自动')],
              ['manual', t('手动')],
              ['control', t('对照片')],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              aria-pressed={threshold.mode === mode}
              className={threshold.mode === mode ? 'segment-active' : ''}
              onClick={() => onThresholdChange({ mode })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {threshold.mode === 'auto' && (
        <div className="field-row">
          <label htmlFor={`${formId}-method`}>{t("自动方法")}</label>
          <select
            id={`${formId}-method`}
            value={threshold.method}
            disabled={disabled}
            onChange={(event) =>
              onThresholdChange({ method: event.target.value as ThresholdConfig['method'] })
            }
          >
            {METHODS.map((method) => (
              <option key={method.id} value={method.id}>{t(method.label)}</option>
            ))}
          </select>
        </div>
      )}

      {threshold.mode === 'manual' && (
        <div className="field-row">
          <label htmlFor={`${formId}-manual-threshold`}>{t("阈值（OD 0–255）")}</label>
          <input
            id={`${formId}-manual-threshold`}
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
            aria-label={t("对照片图像")}
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
            {calibrating ? t('标定中…') : t('导入对照片并标定')}
          </button>
          {threshold.controlThreshold !== null && (
            <p className="panel-note">
              {t("已标定：阈值 ")}{threshold.controlThreshold}{t("（来自 ")}{threshold.controlImageName}）
              <button type="button" className="link-button" onClick={() => onThresholdChange({ controlThreshold: null, controlImageName: null })}>
                {t("清除")}</button>
            </p>
          )}
          <div className="field-row">
            <label htmlFor={`${formId}-false-positive-rate`}>{t("允许假阳率")}</label>
            <input
              id={`${formId}-false-positive-rate`}
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
          <p className="panel-note">{t("阈值取对照分布的 (1−假阳率) 分位；标定后对所有图像统一使用。")}</p>
        </div>
      )}

      <div className="field-row">
        <label htmlFor={`${formId}-background`}>{t("背景百分位")}</label>
        <input
          id={`${formId}-background`}
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

      {collapseSegmentation ? (
        <details className="advanced-block">
          <summary>{t("细胞核分割（可选）")}</summary>
          {segmentationFields}
        </details>
      ) : (
        <>
          <h3>{t("细胞核分割门控")}</h3>
          {segmentationFields}
        </>
      )}

      {presetVectors && (
        <details className="advanced-block">
          <summary>{t("高级：染色向量微调")}</summary>
          <p className="panel-note">
            {t("当前向量出自预设文献值")}{stainVectors === presetVectors ? '' : t('（已自定义）')}{t("。 两种染色的 RGB 向量按你的实际染色协议微调；两向量近乎平行时无法去卷积。")}</p>
          {([0, 1] as const).map((slot) => (
            <div key={slot} className="field-row">
              <span id={`${formId}-vector-${slot}`} className="field-label">{slot === 0 ? t('第一染色 RGB') : t(`第二染色（${quantifyLabel}）RGB`)}</span>
              <span className="vector-inputs" role="group" aria-labelledby={`${formId}-vector-${slot}`}>
                {([0, 1, 2] as const).map((component) => (
                  <input
                    key={component}
                    aria-label={t(`${slot === 0 ? t('第一染色') : t(`第二染色（${quantifyLabel}）`)} ${['R', 'G', 'B'][component]} 向量`)}
                    type="number"
                    min={-1}
                    max={1}
                    step={0.001}
                    value={(stainVectors ?? presetVectors)[slot][component]}
                    disabled={disabled}
                    onChange={(event) => {
                      const current = stainVectors ?? presetVectors;
                      const pair: [Vec3, Vec3] = [current[0], current[1]];
                      pair[slot] = [...pair[slot]] as Vec3;
                      pair[slot][component] = Number(event.target.value) || 0;
                      onVectorsChange(pair);
                    }}
                  />
                ))}
              </span>
            </div>
          ))}
          {stainVectors !== presetVectors && (
            <button type="button" className="link-button" onClick={() => onVectorsChange(null)}>
              {t("恢复预设向量")}</button>
          )}
        </details>
      )}

      <label className="check-row">
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={(event) => onShowOverlayChange(event.target.checked)}
        />
        {t("显示阳性叠加层")}</label>
    </section>
  );
}
