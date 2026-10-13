/**
 * 浏览器端文件解码编排：PNG/JPEG 走 createImageBitmap，TIFF 走 UTIF。
 * 超过工作图上限时在离屏画布上高质量降采样，并记录 workingScale。
 */
import * as UTIF from 'utif';
import type { LoadedImage } from '../types.ts';
import { computeWorkingScale, ifdToRgba, pickMainIfd } from './tiff.ts';

export const MAX_WORKING_EDGE = 4096;

export interface DecodedFile extends LoadedImage {
  pixels: ImageData;
}

function pixelsFromImageData(source: ImageData, workingWidth: number, workingHeight: number): ImageData {
  if (source.width === workingWidth && source.height === workingHeight) return source;
  const canvas = document.createElement('canvas');
  canvas.width = workingWidth;
  canvas.height = workingHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const holder = document.createElement('canvas');
  holder.width = source.width;
  holder.height = source.height;
  holder.getContext('2d')?.putImageData(source, 0, 0);
  ctx.drawImage(holder, 0, 0, workingWidth, workingHeight);
  return ctx.getImageData(0, 0, workingWidth, workingHeight);
}

async function decodeRaster(file: File): Promise<{ pixels: ImageData; sourceType: 'PNG' | 'JPEG' }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法解码该图像文件，请使用 PNG/JPEG/TIFF。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const isJpeg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  return { pixels, sourceType: isJpeg ? 'JPEG' : 'PNG' };
}

async function decodeTiff(file: File): Promise<{ pixels: ImageData; bitsPerSample: number; note?: string }> {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error('TIFF 中没有可读的图像页。');
  UTIF.decodeImages(buffer, ifds);
  const ifd = pickMainIfd(ifds);
  if (!ifd) throw new Error('TIFF 中没有可转换的图像页。');
  const result = ifdToRgba(ifd);
  if (!result) {
    throw new Error('此 TIFF 布局（调色板/分平面等）暂不支持，请从仪器按 RGB 导出普通 TIFF。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = result.pixels.width;
  canvas.height = result.pixels.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');
  const holder = ctx.createImageData(result.pixels.width, result.pixels.height);
  holder.data.set(result.pixels.data);
  ctx.putImageData(holder, 0, 0);
  return {
    pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
    bitsPerSample: result.bitsPerSample,
    note: result.note,
  };
}

export async function decodeImageFile(file: File): Promise<DecodedFile> {
  const lower = file.name.toLowerCase();
  if (/\.(svs|ndpi|mrxs|vsi|scn|bif|svslide)$/.test(lower)) {
    throw new Error('暂不支持厂商全切片格式；请在采集软件中导出普通 TIFF 后导入。');
  }
  const isTiff = /\.tiff?$/i.test(lower) || /tiff?/i.test(file.type);

  let raw: { pixels: ImageData; bitsPerSample: number; note?: string; sourceType: 'PNG' | 'JPEG' | 'TIFF' | 'TIFF16' };
  if (isTiff) {
    const tiff = await decodeTiff(file);
    raw = { ...tiff, sourceType: tiff.bitsPerSample === 16 ? 'TIFF16' : 'TIFF' };
  } else {
    const raster = await decodeRaster(file);
    raw = { ...raster, bitsPerSample: 8 };
  }

  const { scale, workingWidth, workingHeight } = computeWorkingScale(
    raw.pixels.width,
    raw.pixels.height,
    MAX_WORKING_EDGE,
  );
  const pixels = pixelsFromImageData(raw.pixels, workingWidth, workingHeight);
  return {
    name: file.name,
    sourceType: raw.sourceType,
    sourceWidth: raw.pixels.width,
    sourceHeight: raw.pixels.height,
    workingWidth,
    workingHeight,
    workingScale: scale,
    bitsPerSample: raw.bitsPerSample,
    note: raw.note,
    pixels,
  };
}
