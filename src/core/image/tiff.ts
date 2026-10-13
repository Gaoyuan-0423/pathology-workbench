/**
 * TIFF IFD → RGBA 的纯函数转换，node 环境可测（UTIF 本身是纯 JS）。
 *
 * 16bit 纪律：固定 /257 映射（65535→255），绝不做按图对比度拉伸——
 * 定量软件若做逐图拉伸，不同图之间光密度不可比。
 */
import * as UTIF from 'utif';
import type { UtifIfd } from './utif-ifd.ts';
import type { RgbaPixels } from './color.ts';

export interface TiffDecodeResult {
  pixels: RgbaPixels;
  bitsPerSample: number;
  /** 16bit 固定映射等需要在界面/Methods 明示的说明 */
  note?: string;
}

/** 16bit → 8bit 固定标尺：v/257（= v·255/65535），不做拉伸 */
export function scale16to8(v: number): number {
  return Math.min(255, Math.round(v / 257));
}

/** 读取 LE 字节流中的无符号 16 位 */
export function readUint16Le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

/**
 * 把一个已 decodeImage 的 IFD 转为 RGBA。
 * 16bit（灰度/RGB/RGBA、chunky）走固定 /257；其余交给 UTIF.toRGBA8。
 * 返回 null 表示该 IFD 无法转换（如调色板等少见布局）。
 */
export function ifdToRgba(ifd: UtifIfd): TiffDecodeResult | null {
  const width = Number(ifd.width);
  const height = Number(ifd.height);
  if (!(width > 0) || !(height > 0) || !(ifd.data instanceof Uint8Array) || ifd.data.byteLength === 0) {
    return null;
  }

  const bits = ifd.t258 ?? [8];
  const bitsPerSample = Math.max(...bits.map(Number));
  const samples = ifd.t277?.[0] ?? 3;
  const planar = ifd.t284?.[0] ?? 1;

  if (bitsPerSample === 16 && planar === 1 && (samples === 1 || samples === 3 || samples === 4)) {
    const out = new Uint8ClampedArray(width * height * 4);
    const src = ifd.data;
    const step = samples * 2;
    for (let i = 0, s = 0, d = 0; i < width * height; i += 1, s += step, d += 4) {
      if (s + step > src.length) break;
      if (samples === 1) {
        const gray = scale16to8(readUint16Le(src, s));
        out[d] = gray; out[d + 1] = gray; out[d + 2] = gray;
      } else {
        out[d] = scale16to8(readUint16Le(src, s));
        out[d + 1] = scale16to8(readUint16Le(src, s + 2));
        out[d + 2] = scale16to8(readUint16Le(src, s + 4));
      }
      out[d + 3] = 255;
    }
    return {
      pixels: { data: out, width, height },
      bitsPerSample,
      note: '16bit TIFF 按 v/257 固定标尺映射到 8bit（未做对比度拉伸）',
    };
  }

  try {
    const rgba = UTIF.toRGBA8(ifd);
    return {
      pixels: { data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height },
      bitsPerSample,
    };
  } catch {
    return null;
  }
}

/** 多页 TIFF 选主图：面积最大的 IFD（首页通常为全分辨率层） */
export function pickMainIfd(ifds: UtifIfd[]): UtifIfd | null {
  let best: UtifIfd | null = null;
  let bestArea = 0;
  for (const ifd of ifds) {
    const area = Number(ifd.width) * Number(ifd.height);
    if (Number.isFinite(area) && area > bestArea) {
      best = ifd;
      bestArea = area;
    }
  }
  return best;
}

/** 工作图缩放系数：最长边不超过 maxEdge 时的最小整数可行 scale */
export function computeWorkingScale(
  width: number,
  height: number,
  maxEdge: number,
): { scale: number; workingWidth: number; workingHeight: number } {
  const scale = Math.max(1, width / maxEdge, height / maxEdge);
  return {
    scale,
    workingWidth: Math.max(1, Math.round(width / scale)),
    workingHeight: Math.max(1, Math.round(height / scale)),
  };
}
