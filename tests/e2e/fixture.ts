/**
 * 合成 H-DAB 图像生成器（测试夹具）：白背景 + 苏木精核 + 半数 DAB 阳性核。
 * 全程序化生成，不含任何真实实验数据（遵守公开仓库数据纪律）。
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 生成合成 H-DAB PNG（RGBA）。返回 Buffer 与标记信息供断言。 */
export function createSyntheticHdabPng(
  width = 400,
  height = 300,
): { buffer: Buffer; positiveNuclei: number; totalNuclei: number } {
  let seed = 20260101 >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const pixels = new Uint8Array(width * height * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    pixels[i] = Math.max(0, Math.min(255, Math.round(r)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    pixels[i + 3] = 255;
  };

  // 背景：接近白色的组织底色 + 轻噪声
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = (next() - 0.5) * 10;
      setPixel(x, y, 246 + noise, 246 + noise, 242 + noise);
    }
  }

  // 细胞核：网格布点 + 抖动，50% 为 DAB 阳性（棕色），其余为纯苏木精（蓝紫）
  const spacingX = 40;
  const spacingY = 36;
  let totalNuclei = 0;
  let positiveNuclei = 0;
  for (let gy = 1; gy * spacingY < height - 20; gy += 1) {
    for (let gx = 1; gx * spacingX < width - 20; gx += 1) {
      const cx = gx * spacingX + (next() - 0.5) * 10;
      const cy = gy * spacingY + (next() - 0.5) * 10;
      const radius = 8 + next() * 5;
      const positive = next() < 0.5;
      totalNuclei += 1;
      if (positive) positiveNuclei += 1;
      for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > radius) continue;
          const edge = d / radius;
          const noise = (next() - 0.5) * 12;
          if (positive) {
            // 棕色 DAB：红高蓝低（归一化 R−B 显著为正）
            setPixel(x, y, 150 - 55 * edge + noise, 108 - 45 * edge + noise, 66 - 30 * edge + noise);
          } else {
            // 蓝紫苏木精
            setPixel(x, y, 96 - 30 * edge + noise, 92 - 30 * edge + noise, 150 - 45 * edge + noise);
          }
        }
      }
    }
  }

  // 编码 PNG（RGBA8，filter 0）
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { buffer: png, positiveNuclei, totalNuclei };
}
