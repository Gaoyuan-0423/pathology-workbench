import { t } from '../i18n.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Roi } from '../core/types.ts';

interface View { scale: number; tx: number; ty: number }

interface CanvasViewProps {
  pixels: ImageData | null;
  rois?: Roi[];
  overlay?: ImageData | null;
  /** ROI 框选模式 */
  drawRoi?: boolean;
  /** 比例尺标定线段模式 */
  drawLine?: boolean;
  onRoiDrawn?: (roi: { x: number; y: number; w: number; h: number }) => void;
  onLineDrawn?: (lengthPx: number) => void;
}

function makeOffscreen(pixels: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  return canvas;
}

const ROI_COLORS = ['#7c3aed', '#0891b2', '#b45309', '#be185d', '#15803d', '#4338ca'];

export default function CanvasView({
  pixels,
  rois,
  overlay,
  drawRoi,
  drawLine,
  onRoiDrawn,
  onLineDrawn,
}: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreen = useMemo(() => (pixels ? makeOffscreen(pixels) : null), [pixels]);
  const overlayCanvas = useMemo(() => (overlay ? makeOffscreen(overlay) : null), [overlay]);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverRoi, setHoverRoi] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hoverLine, setHoverLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; origin: View }
    | { kind: 'draw'; startX: number; startY: number; origin: View }
  | { kind: 'line'; startX: number; startY: number; origin: View }
  | null>(null);
  const fittedRef = useRef(false);

  const fit = useCallback(() => {
    if (!pixels || size.w === 0 || size.h === 0) return;
    const scale = Math.min(size.w / pixels.width, size.h / pixels.height) * 0.96;
    setView({
      scale,
      tx: (size.w - pixels.width * scale) / 2,
      ty: (size.h - pixels.height * scale) / 2,
    });
  }, [pixels, size]);

  useEffect(() => {
    fittedRef.current = false;
  }, [pixels, size.w, size.h]);

  useEffect(() => {
    if (pixels && !fittedRef.current && size.w > 0) {
      fittedRef.current = true;
      fit();
    }
  }, [pixels, size, fit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef0f6';
    ctx.fillRect(0, 0, size.w, size.h);
    if (!offscreen || !pixels) return;

    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);
    ctx.drawImage(offscreen, 0, 0);
    if (overlayCanvas) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(overlayCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // ROI 框（工作图坐标 → 屏幕坐标）
    ctx.lineWidth = 2;
    ctx.font = '12px ui-sans-serif, system-ui';
    (rois ?? []).forEach((roi, index) => {
      const color = ROI_COLORS[index % ROI_COLORS.length];
      ctx.strokeStyle = color;
      ctx.fillStyle = `${color}14`;
      const x = roi.x * view.scale + view.tx;
      const y = roi.y * view.scale + view.ty;
      ctx.fillRect(x, y, roi.w * view.scale, roi.h * view.scale);
      ctx.strokeRect(x, y, roi.w * view.scale, roi.h * view.scale);
      ctx.fillStyle = color;
      ctx.fillText(roi.name || `ROI${index + 1}`, x + 4, y + 14);
    });
    if (hoverRoi) {
      ctx.strokeStyle = '#7c3aed';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(
        hoverRoi.x * view.scale + view.tx,
        hoverRoi.y * view.scale + view.ty,
        hoverRoi.w * view.scale,
        hoverRoi.h * view.scale,
      );
      ctx.setLineDash([]);
    }
    if (hoverLine) {
      ctx.strokeStyle = '#0891b2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hoverLine.x1 * view.scale + view.tx, hoverLine.y1 * view.scale + view.ty);
      ctx.lineTo(hoverLine.x2 * view.scale + view.tx, hoverLine.y2 * view.scale + view.ty);
      ctx.stroke();
      const lengthPx = Math.hypot(hoverLine.x2 - hoverLine.x1, hoverLine.y2 - hoverLine.y1);
      ctx.fillStyle = '#0891b2';
      ctx.fillText(`${lengthPx.toFixed(1)} px`, hoverLine.x2 * view.scale + view.tx + 6, hoverLine.y2 * view.scale + view.ty - 6);
    }
  }, [pixels, offscreen, overlayCanvas, view, size, rois, hoverRoi, hoverLine]);

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.tx) / view.scale,
        y: (clientY - rect.top - view.ty) / view.scale,
      };
    },
    [view],
  );

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    setView((prev) => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const scale = Math.min(40, Math.max(0.02, prev.scale * factor));
      const k = scale / prev.scale;
      return { scale, tx: mx - (mx - prev.tx) * k, ty: my - (my - prev.ty) * k };
    });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const start = toImage(event.clientX, event.clientY);
      const kind = drawRoi ? 'draw' : drawLine ? 'line' : 'pan';
      dragRef.current = { kind, startX: start.x, startY: start.y, origin: view };
    },
    [drawRoi, drawLine, toImage, view],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'pan') {
        setView({
          ...drag.origin,
          tx: drag.origin.tx + (event.clientX - drag.startX),
          ty: drag.origin.ty + (event.clientY - drag.startY),
        });
      } else {
        const cur = toImage(event.clientX, event.clientY);
        if (drag.kind === 'draw') {
          setHoverRoi({
            x: Math.min(drag.startX, cur.x),
            y: Math.min(drag.startY, cur.y),
            w: Math.abs(cur.x - drag.startX),
            h: Math.abs(cur.y - drag.startY),
          });
        } else {
          setHoverLine({ x1: drag.startX, y1: drag.startY, x2: cur.x, y2: cur.y });
        }
      }
    },
    [toImage],
  );

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'draw' && hoverRoi && hoverRoi.w > 3 && hoverRoi.h > 3) {
      onRoiDrawn?.(hoverRoi);
    }
    if (drag?.kind === 'line' && hoverLine) {
      const lengthPx = Math.hypot(hoverLine.x2 - hoverLine.x1, hoverLine.y2 - hoverLine.y1);
      if (lengthPx > 3) onLineDrawn?.(lengthPx);
    }
    setHoverRoi(null);
    setHoverLine(null);
  }, [hoverRoi, hoverLine, onRoiDrawn, onLineDrawn]);

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <div className="canvas-toolbar">
        <button type="button" onClick={fit} disabled={!pixels}>{t("适配窗口")}</button>
        <button
          type="button"
          onClick={() => setView((prev) => ({ ...prev, scale: 1 }))}
          disabled={!pixels}
        >
          100%
        </button>
        <span className="canvas-zoom">{Math.round(view.scale * 100)}%</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: size.w || undefined,
          height: size.h || undefined,
          cursor: drawRoi || drawLine ? 'crosshair' : 'grab',
        }}
        className="canvas-main"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {!pixels && <div className="canvas-empty"><div className="canvas-empty-content"><span className="empty-image-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="8" y="8" width="32" height="32" rx="5"/><circle cx="19" cy="19" r="3"/><path d="m9 32 10-9 8 7 6-5 7 7" strokeLinecap="round" strokeLinejoin="round"/></svg></span><h2>{t("在这里观察每一处细节")}</h2><p>{t("导入图像后，可框选 ROI、标定比例尺并核对分割结果。")}</p><span className="empty-image-note">{t("分析结果会显示在图像下方")}</span></div></div>}
    </div>
  );
}
