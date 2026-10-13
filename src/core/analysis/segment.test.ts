import { describe, expect, it } from 'vitest';
import {
  connectedComponents,
  gateComponents,
  meanChannelOverComponent,
  summarizeComponents,
} from './segment.ts';

function maskFrom(width: number, height: number, cells: Array<[number, number]>): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of cells) mask[y * width + x] = 1;
  return mask;
}

describe('connectedComponents', () => {
  it('分离两个不相连的方块，8 连通把对角像素归为同一目标', () => {
    // 3×3 方块在 (1,1)-(3,3)；单像素在 (6,6)；对角链接测试：(4,4) 与 (3,3) 对角相邻
    const mask = maskFrom(8, 8, [
      [1, 1], [2, 1], [3, 1],
      [1, 2], [2, 2], [3, 2],
      [1, 3], [2, 3], [3, 3],
      [6, 6],
    ]);
    const components = connectedComponents(mask, 8, 8);
    expect(components).toHaveLength(2);
    const square = components.find((c) => c.area === 9)!;
    expect(square.cx).toBeCloseTo(2, 6);
    expect(square.cy).toBeCloseTo(2, 6);
    expect(square.touchesBorder).toBe(false);
    expect(square.circularity).toBeGreaterThan(0.7); // 实心方形圆度高
  });

  it('8 连通对角像素合并为一个目标', () => {
    const mask = maskFrom(4, 4, [[0, 0], [1, 1]]);
    const components = connectedComponents(mask, 4, 4);
    expect(components).toHaveLength(1);
    expect(components[0].area).toBe(2);
  });

  it('触边目标标记 touchesBorder', () => {
    const mask = maskFrom(5, 5, [[0, 0], [0, 1], [1, 0]]);
    const [component] = connectedComponents(mask, 5, 5);
    expect(component.touchesBorder).toBe(true);
  });

  it('单像素目标：面积 1、周长 4、圆度 ≈ 0.785', () => {
    const mask = maskFrom(3, 3, [[1, 1]]);
    const [component] = connectedComponents(mask, 3, 3);
    expect(component.area).toBe(1);
    expect(component.perimeter).toBe(4);
    expect(component.circularity).toBeCloseTo((4 * Math.PI) / 16, 6);
  });
});

describe('gateComponents', () => {
  const defaults = { minAreaPx: 4, maxAreaPx: 20, minCircularity: 0.2 };
  it('面积与圆度门控分开计数拒绝原因', () => {
    const mask = maskFrom(10, 10, [
      // 目标 A：2×2 = 4px，圆度 1 → 通过
      [1, 1], [2, 1], [1, 2], [2, 2],
      // 目标 B：1px → 面积拒绝
      [6, 1],
      // 目标 C：5×5 = 25px → 超面积拒绝
      [1, 5], [2, 5], [3, 5], [4, 5], [5, 5],
      [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
      [1, 7], [2, 7], [3, 7], [4, 7], [5, 7],
      [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
      [1, 9], [2, 9], [3, 9], [4, 9], [5, 9],
    ]);
    const components = connectedComponents(mask, 10, 10);
    const { kept, rejectedArea, rejectedCircularity } = gateComponents(components, defaults);
    expect(kept).toHaveLength(1);
    expect(rejectedArea).toBe(2);
    expect(rejectedCircularity).toBe(0);
  });
});

describe('summarizeComponents', () => {
  it('边界折算：n + border·n/(n+border)', () => {
    const inside = [
      { area: 10, perimeter: 12, cx: 5, cy: 5, touchesBorder: false, equivalentDiameter: 3.6, circularity: 0.9 },
      { area: 10, perimeter: 12, cx: 6, cy: 5, touchesBorder: false, equivalentDiameter: 3.6, circularity: 0.9 },
    ];
    const border = [
      { area: 8, perimeter: 12, cx: 0, cy: 0, touchesBorder: true, equivalentDiameter: 3.2, circularity: 0.8 },
    ];
    const summary = summarizeComponents([...inside, ...border]);
    expect(summary.count).toBe(3);
    expect(summary.borderCount).toBe(1);
    expect(summary.estimatedTotal).toBeCloseTo(3 + (1 * 3) / 4, 1); // 3.75 → 3.8
  });

  it('空目标返回 0', () => {
    const summary = summarizeComponents([]);
    expect(summary.count).toBe(0);
    expect(summary.estimatedTotal).toBe(0);
  });
});

describe('meanChannelOverComponent', () => {
  it('只对连通目标内像素求均值', () => {
    const width = 6;
    const height = 3;
    const channel = new Float32Array(width * height).fill(0);
    const mask = new Uint8Array(width * height);
    const cells = [[1, 1], [2, 1], [3, 1]] as const;
    for (const [x, y] of cells) {
      mask[y * width + x] = 1;
      channel[y * width + x] = 30 + 6 * x; // 36, 42, 48 → 均值 42
    }
    channel[1 * width + 4] = 999; // 模外像素不应计入
    const mean = meanChannelOverComponent(channel, width, mask, cells[0][1] * width + cells[0][0]);
    expect(mean).toBeCloseTo(42, 6);
  });
});
