/**
 * 连通域分割与细胞核计数。
 *
 * - 8 连通域，迭代式洪泛（无递归，可处理全图大目标）
 * - 周长用 4 邻域边界边计数（对数字目标系统性偏高 ~20–30%，
 *   因此圆度门控默认值取得很宽松 0.08；Methods 中明示定义）
 * - 边界折算：estimatedTotal = n + border·n/(n+border)（假设边界带密度与内部一致），
 *   同时单独给出 borderCount 供审稿人核查
 */
import type { SegmentationConfig } from '../types.ts';

export interface Component {
  /** 像素面积 */
  area: number;
  /** 4 邻域边界边计数近似周长 */
  perimeter: number;
  /** 质心（图像坐标） */
  cx: number;
  cy: number;
  touchesBorder: boolean;
  /** 等效圆直径 2√(A/π) */
  equivalentDiameter: number;
  /** 4πA/P² */
  circularity: number;
}

const NEIGHBORS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** 8 连通域标记；mask 中 >0 视为前景 */
export function connectedComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const visited = new Uint8Array(mask.length);
  const components: Component[] = [];
  const stack = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start]) continue;
    let top = 0;
    stack[top] = start;
    visited[start] = 1;
    let area = 0;
    let perimeterEdges = 0;
    let sumX = 0;
    let sumY = 0;
    let touchesBorder = false;

    while (top >= 0) {
      const index = stack[top];
      top -= 1;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const neighbor = ny * width + nx;
        if (mask[neighbor] === 0) {
          if (dx === 0 || dy === 0) perimeterEdges += 1; // 只计 4 邻域边界边
        } else if (!visited[neighbor]) {
          visited[neighbor] = 1;
          top += 1;
          stack[top] = neighbor;
        }
      }
    }

    const perimeter = Math.max(perimeterEdges, 1);
    components.push({
      area,
      perimeter,
      cx: sumX / area,
      cy: sumY / area,
      touchesBorder,
      equivalentDiameter: 2 * Math.sqrt(area / Math.PI),
      circularity: (4 * Math.PI * area) / (perimeter * perimeter),
    });
  }
  return components;
}

/** 面积与圆度门控 */
export function gateComponents(
  components: Component[],
  config: SegmentationConfig,
): { kept: Component[]; rejectedArea: number; rejectedCircularity: number } {
  const kept: Component[] = [];
  let rejectedArea = 0;
  let rejectedCircularity = 0;
  for (const component of components) {
    if (component.area < config.minAreaPx || component.area > config.maxAreaPx) {
      rejectedArea += 1;
      continue;
    }
    if (component.circularity < config.minCircularity) {
      rejectedCircularity += 1;
      continue;
    }
    kept.push(component);
  }
  return { kept, rejectedArea, rejectedCircularity };
}

export interface ComponentSummary {
  count: number;
  borderCount: number;
  /** 边界折算估计：n + border·n/(n+border) */
  estimatedTotal: number;
}

export function summarizeComponents(components: Component[]): ComponentSummary {
  const count = components.length;
  const borderCount = components.reduce((sum, item) => sum + (item.touchesBorder ? 1 : 0), 0);
  const estimatedTotal =
    count + borderCount > 0 ? count + (borderCount * count) / (count + borderCount) : count;
  return { count, borderCount, estimatedTotal: Math.round(estimatedTotal * 10) / 10 };
}

/** 计算目标在 DAB 通道上的平均光密度（用于阳性核判定） */
export function meanChannelOverComponent(
  channel: Float32Array,
  width: number,
  mask: Uint8Array,
  seedIndex: number,
): number {
  // 从种子重走一次洪泛取均值（component 数量有限，代价可接受）
  const height = mask.length / width;
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let top = 0;
  stack[top] = seedIndex;
  visited[seedIndex] = 1;
  let sum = 0;
  let area = 0;
  while (top >= 0) {
    const index = stack[top];
    top -= 1;
    sum += channel[index];
    area += 1;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (mask[neighbor] > 0 && !visited[neighbor]) {
        visited[neighbor] = 1;
        top += 1;
        stack[top] = neighbor;
      }
    }
  }
  return area > 0 ? sum / area : 0;
}
