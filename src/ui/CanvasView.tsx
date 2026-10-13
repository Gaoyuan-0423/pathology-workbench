import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Roi } from '../core/types.ts';

interface View { scale: number; tx: number; ty: number }

interface CanvasViewProps {
  pixels: ImageData | null;
  rois?: Roi[];
  /** 是否处于 ROI 绘制模式（M3 起使用）；绘制中显示十字光标 */
  drawRoi?: boolean;
  onRoiDrawn?: (roi: { x: number; y: number; w: number; h: number }) => void;
}

function makeOffscreen(pixels: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  return canvas;
}

const ROI_COLORS = ['#7c3aed', '#0891b2', '#b45309', '#be185d', '#15803d', '#4338ca'];

export default function CanvasView({ pixels, rois, drawRoi, onRoiDrawn }: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreen = useMemo(() => (pixels ? makeOffscreen(pixels) : null), [pixels]);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverRoi, setHoverRoi] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ kind: 'pan' | 'draw'; startX: number; startY: number; origin: View } | null>(null);
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
  }, [pixels]);

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
    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(0, 0, size.w, size.h);
    if (!offscreen || !pixels) return;

    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);
    ctx.drawImage(offscreen, 0, 0);
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
  }, [pixels, offscreen, view, size, rois, hoverRoi]);

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
      dragRef.current = drawRoi
        ? { kind: 'draw', startX: start.x, startY: start.y, origin: view }
        : { kind: 'pan', startX: event.clientX, startY: event.clientY, origin: view };
    },
    [drawRoi, toImage, view],
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
        setHoverRoi({
          x: Math.min(drag.startX, cur.x),
          y: Math.min(drag.startY, cur.y),
          w: Math.abs(cur.x - drag.startX),
          h: Math.abs(cur.y - drag.startY),
        });
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
    setHoverRoi(null);
  }, [hoverRoi, onRoiDrawn]);

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <div className="canvas-toolbar">
        <button type="button" onClick={fit} disabled={!pixels}>适配窗口</button>
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
        style={{ width: size.w || undefined, height: size.h || undefined, cursor: drawRoi ? 'crosshair' : 'grab' }}
        className="canvas-main"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {!pixels && <div className="canvas-empty">导入图像后在此显示</div>}
    </div>
  );
}
