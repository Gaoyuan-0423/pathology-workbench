import type { Roi } from '../core/types.ts';

interface RoiListProps {
  rois: Roi[];
  drawRoi: boolean;
  drawLine: boolean;
  onDrawRoiToggle: (value: boolean) => void;
  onDrawLineToggle: (value: boolean) => void;
  onDelete: (id: string) => void;
}

export default function RoiList({
  rois,
  drawRoi,
  drawLine,
  onDrawRoiToggle,
  onDrawLineToggle,
  onDelete,
}: RoiListProps) {
  return (
    <section className="panel">
      <h3>区域与标定</h3>
      <div className="mode-buttons">
        <button
          type="button"
          className={drawRoi ? 'segment-active' : ''}
          onClick={() => onDrawRoiToggle(!drawRoi)}
        >
          {drawRoi ? '完成框选' : '框选 ROI'}
        </button>
        <button
          type="button"
          className={drawLine ? 'segment-active' : ''}
          onClick={() => onDrawLineToggle(!drawLine)}
        >
          {drawLine ? '取消标尺线' : '画标尺线'}
        </button>
      </div>
      {rois.length === 0 ? (
        <p className="panel-note">尚未框选 ROI；不框选时整图分析。</p>
      ) : (
        <ul className="roi-list">
          {rois.map((roi, index) => (
            <li key={roi.id}>
              <span className={`roi-dot roi-dot-${index % 6}`} />
              {roi.name}
              <span className="roi-size">{Math.round(roi.w)}×{Math.round(roi.h)}</span>
              <button type="button" className="link-button" onClick={() => onDelete(roi.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
