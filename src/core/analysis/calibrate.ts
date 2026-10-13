/**
 * 对照片标定：由未染色/阴性对照片的 DAB 通道分布反推阈值。
 * 阈值 v 满足"对照图中 od > v 的像素比例 = 假阳率"（即 (1−fp) 下秩分位）。
 * 思路源自 DAB-quant 的对照自动标定（GPL，仅借鉴方法，独立实现）。
 */
import { histogram256 } from './threshold.ts';

export function controlThresholdFromChannel(
  channel: Float32Array,
  falsePositiveRate: number,
): number {
  const hist = histogram256(channel);
  let total = 0;
  for (let i = 0; i < 256; i += 1) total += hist[i];
  if (total === 0) return 0;
  const fp = Math.min(0.2, Math.max(0, falsePositiveRate));
  const target = (1 - fp) * total;
  let cum = 0;
  for (let i = 0; i < 256; i += 1) {
    cum += hist[i];
    if (cum >= target) return i;
  }
  return 255;
}
