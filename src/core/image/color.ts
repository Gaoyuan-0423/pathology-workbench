/**
 * sRGB → 光密度（OD）与 Ruifrok 颜色去卷积。
 *
 * OD 变换沿用 Ruifrok 2001 的 8bit 标尺（IHC Profiler / skimage 同款，带 +1 钳制）：
 *   od = 255 · ln(255 / (v + 1)) / ln(255)  ∈ [0, 255]
 * 去卷积即在 OD 空间解 3×3 线性方程组 c = M⁻¹·od，M 的列为单位化染色向量。
 * 第三（残差）向量取 H×DAB 叉积的正交补，避免 Ruifrok 原文的零向量奇异问题。
 */

export type Vec3 = [number, number, number];

/** Ruifrok & Johnston 2001 标准 H-DAB 向量（公开文献常数） */
export const HEMATOXYLIN_VECTOR: Vec3 = [0.684, 0.696, 0.183];
export const DAB_VECTOR: Vec3 = [0.25, 0.5, 0.85];

const LN255 = Math.log(255);

/** 单通道 8bit 灰度值 → OD（0–255 标尺；+1 钳制带来的端点溢出截回 0–255） */
export function channelToOd(value: number): number {
  const raw = (255 * Math.log(255 / (Math.max(0, Math.min(255, value)) + 1))) / LN255;
  return Math.min(255, Math.max(0, raw));
}

export function vectorNorm(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function normalizeVector(v: Vec3): Vec3 {
  const n = vectorNorm(v);
  if (n === 0) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** a×b 叉积 */
export function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export interface DeconvolutionMatrix {
  /** 单位化后的行向量：第一染色 / 第二染色 / 残差（相互正交） */
  stains: [Vec3, Vec3, Vec3];
  /** M⁻¹（行 = 各染色浓度的系数），解 c = inv·od */
  inverse: number[][];
}

/** 由双色向量构建去卷积矩阵（残差取叉积正交补）——任意染色预设通用 */
export function buildStainMatrix(first: Vec3, second: Vec3): DeconvolutionMatrix {
  const h = normalizeVector(first);
  const d = normalizeVector(second);
  const residual = normalizeVector(crossProduct(h, d));
  const stains: [Vec3, Vec3, Vec3] = [h, d, residual];

  // 3×3 求逆（列向量组成本矩阵 M）
  const m = [
    [h[0], d[0], residual[0]],
    [h[1], d[1], residual[1]],
    [h[2], d[2], residual[2]],
  ];
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-12) throw new Error('去卷积矩阵奇异');
  const inv = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
    ],
  ];
  return { stains, inverse: inv };
}

/** H-DAB 预设便捷入口（v1 兼容） */
export function buildHdabMatrix(): DeconvolutionMatrix {
  return buildStainMatrix(HEMATOXYLIN_VECTOR, DAB_VECTOR);
}

/** 便捷单像素 OD 向量 */
export function pixelToOd(r: number, g: number, b: number): Vec3 {
  return [channelToOd(r), channelToOd(g), channelToOd(b)];
}

/**
 * 去卷积一个 OD 向量，返回各染色浓度（与 OD 同标尺 0–255；可为负，调用方按需截断）。
 */
export function applyInverse(inv: number[][], od: Vec3): Vec3 {
  return [
    inv[0][0] * od[0] + inv[0][1] * od[1] + inv[0][2] * od[2],
    inv[1][0] * od[0] + inv[1][1] * od[1] + inv[1][2] * od[2],
    inv[2][0] * od[0] + inv[2][1] * od[1] + inv[2][2] * od[2],
  ];
}

/** core 层不直接依赖 DOM 的 ImageData，用最小结构接口（ImageData 天然满足） */
export interface RgbaPixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** 提取指定染色通道（0 = 第一染色，1 = 第二染色；0–255 OD 标尺，负值截断为 0） */
export function extractStainChannel(
  pixels: RgbaPixels,
  matrix: DeconvolutionMatrix,
  channelIndex: 0 | 1,
): Float32Array {
  const { data, width, height } = pixels;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    const od = pixelToOd(data[p], data[p + 1], data[p + 2]);
    const value = applyInverse(matrix.inverse, od)[channelIndex];
    out[i] = value > 0 ? value : 0;
  }
  return out;
}

/** 提取 DAB 通道（H-DAB 预设便捷入口） */
export function extractDabChannel(pixels: RgbaPixels): Float32Array {
  return extractStainChannel(pixels, buildHdabMatrix(), 1);
}

/** 提取苏木精通道（对称用途：核复染检查、双层展示） */
export function extractHematoxylinChannel(pixels: RgbaPixels): Float32Array {
  return extractStainChannel(pixels, buildHdabMatrix(), 0);
}
