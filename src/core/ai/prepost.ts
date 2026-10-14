/**
 * AI 核分割的前/后处理纯函数（node 可测，无 DOM / 无 ort 依赖）。
 * 约定：模型输入 NCHW、归一化 0–1；输出单通道概率图（0–1）或 logits（自动 sigmoid）。
 */

/** 双线性缩放灰度图 */
export function resizeGray(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Float32Array(dw * dh);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x += 1) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const v00 = src[y0 * sw + x0];
      const v01 = src[y0 * sw + x1];
      const v10 = src[y1 * sw + x0];
      const v11 = src[y1 * sw + x1];
      out[y * dw + x] =
        v00 * (1 - wx) * (1 - wy) + v01 * wx * (1 - wy) + v10 * (1 - wx) * wy + v11 * wx * wy;
    }
  }
  return out;
}

/** 灰度图 → NCHW 张量（channels 1 = 灰度复制；3 = 三通道同值），归一化 0–1 */
export function toModelTensor(
  gray: Float32Array,
  width: number,
  height: number,
  channels: 1 | 3,
): Float32Array {
  const out = new Float32Array(channels * width * height);
  for (let c = 0; c < channels; c += 1) {
    const base = c * width * height;
    for (let i = 0; i < gray.length; i += 1) {
      out[base + i] = gray[i] / 255;
    }
  }
  return out;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** 概率图 → 掩膜；若存在 <0 或 >1 的值视作 logits 自动过 sigmoid */
export function probToMask(prob: Float32Array, threshold = 0.5): Uint8Array {
  let needsSigmoid = false;
  for (let i = 0; i < prob.length; i += 1) {
    if (prob[i] < 0 || prob[i] > 1) {
      needsSigmoid = true;
      break;
    }
  }
  const mask = new Uint8Array(prob.length);
  for (let i = 0; i < prob.length; i += 1) {
    mask[i] = (needsSigmoid ? sigmoid(prob[i]) : prob[i]) > threshold ? 1 : 0;
  }
  return mask;
}

/** 从模型输出数组中推断 H×W：优先精确整除；否则取最接近平方拆分的因子对 */
export function inferPlaneSize(length: number, inputW: number, inputH: number): { width: number; height: number } {
  if (length === inputW * inputH) return { width: inputW, height: inputH };
  // 常见布局：[1,1,H,W] 展平或 [1,H,W]
  let best = { width: inputW, height: Math.round(length / Math.max(1, inputW)) };
  if (best.width * best.height === length) return best;
  for (let candidate = 1; candidate * candidate <= length; candidate += 1) {
    if (length % candidate === 0) {
      best = { width: length / candidate, height: candidate };
    }
  }
  return best;
}
