import { describe, expect, it } from 'vitest';
import { controlThresholdFromChannel } from './calibrate.ts';

function channelFrom(values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('controlThresholdFromChannel', () => {
  // 三档分布：400×0, 450×40, 150×90（共 1000）；fp 测试值均在 [0, 0.2] 钳制范围内
  const channel = channelFrom([
    ...Array.from({ length: 400 }, () => 0),
    ...Array.from({ length: 450 }, () => 40),
    ...Array.from({ length: 150 }, () => 90),
  ]);

  it('阈值按 (1−fp) 下秩分位取 bin，假阳率不超约限', () => {
    expect(controlThresholdFromChannel(channel, 0.05)).toBe(90); // >90 比例 0
    expect(controlThresholdFromChannel(channel, 0.15)).toBe(40); // >40 比例 0.15
  });

  it('fp 越大阈值越低', () => {
    const channel = channelFrom([
      ...Array.from({ length: 900 }, () => 5),
      ...Array.from({ length: 100 }, (_, i) => 30 + i), // 30..129
    ]);
    const strict = controlThresholdFromChannel(channel, 0.001);
    const loose = controlThresholdFromChannel(channel, 0.1);
    expect(loose).toBeLessThan(strict);
  });

  it('全零对照片返回 0', () => {
    expect(controlThresholdFromChannel(channelFrom([0, 0, 0]), 0.001)).toBe(0);
  });

  it('非法 fp 被钳制到 [0, 0.2]', () => {
    const channel = channelFrom([0, 50]);
    expect(controlThresholdFromChannel(channel, 5)).toBe(controlThresholdFromChannel(channel, 0.2));
    expect(controlThresholdFromChannel(channel, -1)).toBe(controlThresholdFromChannel(channel, 0));
  });
});
