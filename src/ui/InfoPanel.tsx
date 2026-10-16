import { t } from '../i18n.ts';
import type { Calibration, LoadedImage } from '../core/types.ts';

interface InfoPanelProps {
  image: LoadedImage | null;
  calibration: Calibration;
  onMppChange: (mpp: number | null) => void;
  onClear: () => void;
}

function fmtScale(scale: number): string {
  return scale === 1 ? '1:1（原始分辨率）' : `${(1 / scale).toFixed(2)}:1 降采样`;
}

export default function InfoPanel({ image, calibration, onMppChange, onClear }: InfoPanelProps) {
  if (!image) return null;
  return (
    <section className="panel">
      <h3>{t("图像信息")}</h3>
      <dl className="kv">
        <dt>{t("文件")}</dt>
        <dd title={image.name}>{image.name}</dd>
        <dt>{t("来源格式")}</dt>
        <dd>
          {image.sourceType}
          {image.sourceType === 'TIFF16' ? ` · ${image.bitsPerSample}bit` : ''}
        </dd>
        <dt>{t("原始尺寸")}</dt>
        <dd>{image.sourceWidth} × {image.sourceHeight} px</dd>
        <dt>{t("工作图")}</dt>
        <dd>
          {image.workingWidth} × {image.workingHeight} px（{t(fmtScale(image.workingScale))}）
        </dd>
        <dt>{t("像素尺寸")}</dt>
        <dd>
          <input
            type="number"
            min={0.0005}
            max={100}
            step={0.01}
            value={calibration.mpp ?? ''}
            placeholder={t("μm/px（可选）")}
            onChange={(event) => {
              const value = Number(event.target.value);
              onMppChange(Number.isFinite(value) && value > 0 ? value : null);
            }}
          />
        </dd>
      </dl>
      {image.note && <p className="panel-note">{t(image.note)}</p>}
      <p className="panel-note">
        {t("假定像素值为 sRGB；未做任何颜色管理转换。标定 μm/px 后方可输出细胞密度。")}</p>
      <button type="button" className="button-danger" onClick={onClear}>{t("清除图像")}</button>
    </section>
  );
}
