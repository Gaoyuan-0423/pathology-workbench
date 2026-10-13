import { describe, expect, it } from 'vitest';
import {
  bonferroni,
  dagostinoPearson,
  holm,
  kruskalWallis,
  leveneTest,
  mannWhitneyU,
  significanceStars,
  welchTTest,
} from './stats.ts';

// 标准表值与教科书算例对照

describe('移植部分（Welch t / ANOVA）', () => {
  it('Welch t：[1..6] vs [3..8] 双侧 p≈0.094', () => {
    const { p } = welchTTest([1, 2, 3, 4, 5, 6], [3, 4, 5, 6, 7, 8]);
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.2);
  });

  it('相同分布两组：p 接近 1', () => {
    const a = [10, 11, 12, 13, 14];
    const { p } = welchTTest(a, [10.1, 10.9, 11.5, 12.4, 13.6]);
    expect(p).toBeGreaterThan(0.5);
  });
});

describe('mannWhitneyU', () => {
  it('完全分离的两组：p 达最小值', () => {
    const { p } = mannWhitneyU([1, 2, 3, 4, 5, 6, 7, 8], [10, 11, 12, 13, 14, 15, 16, 17]);
    expect(p).toBeLessThan(0.001);
  });

  it('相同分布两组：p 大', () => {
    const { p } = mannWhitneyU([5, 6, 7, 8, 9, 10, 11, 12], [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]);
    expect(p).toBeGreaterThan(0.5);
  });

  it('结值不崩溃（全相同值）', () => {
    const { p } = mannWhitneyU([7, 7, 7, 7], [7, 7, 7, 7]);
    expect(p).toBe(1);
  });

  it('大样本显著差异：U 检验与 t 检验结论一致', () => {
    const a = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const b = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    expect(mannWhitneyU(a, b).p).toBeLessThan(0.05);
    expect(welchTTest(a, b).p).toBeLessThan(0.05);
  });
});

describe('kruskalWallis', () => {
  it('三组完全分离：p 显著', () => {
    const { p, df } = kruskalWallis([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [10, 11, 12, 13, 14, 15, 16, 17],
      [20, 21, 22, 23, 24, 25, 26, 27],
    ]);
    expect(df).toBe(2);
    expect(p).toBeLessThan(0.001);
  });

  it('三组同分布：p 大', () => {
    const { p } = kruskalWallis([
      [5, 6, 7, 8, 9],
      [5.5, 6.5, 7.5, 8.5, 9.5],
      [4.8, 6.2, 7.1, 8.8, 9.2],
    ]);
    expect(p).toBeGreaterThan(0.5);
  });
});

describe('leveneTest', () => {
  it('方差相同：p 大', () => {
    const { p } = leveneTest([
      [10, 11, 12, 13, 14, 15, 16, 17],
      [20, 21, 22, 23, 24, 25, 26, 27],
    ]);
    expect(p).toBeGreaterThan(0.5);
  });

  it('方差悬殊：p 小', () => {
    const { p } = leveneTest([
      [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7],
      [1, 5, 9, 13, 17, 21, 25, 29],
    ]);
    expect(p).toBeLessThan(0.05);
  });
});

describe('bonferroni 与 holm', () => {
  it('bonferroni 乘以比较数并封顶 1', () => {
    expect(bonferroni([0.01, 0.03, 0.6])).toEqual([0.03, 0.09, 1]);
  });

  it('holm step-down 单调且保序', () => {
    const adjusted = holm([0.01, 0.04, 0.03]);
    // 排序 0.01(×3)=0.03, 0.03(×2)=0.06, 0.04(×1)=0.04 → 单调化后 [0.03, 0.06, 0.06]
    expect(adjusted[0]).toBeCloseTo(0.03, 10);
    expect(adjusted[1]).toBeCloseTo(0.06, 10);
    expect(adjusted[2]).toBeCloseTo(0.06, 10);
  });

  it('holm 不小于原始 p 且不超过 1', () => {
    const ps = [0.001, 0.2, 0.9];
    const adjusted = holm(ps);
    adjusted.forEach((value, index) => {
      expect(value).toBeGreaterThanOrEqual(ps[index]);
      expect(value).toBeLessThanOrEqual(1);
    });
  });
});

// 确定性 mulberry32 + Irwin–Hall(12) 生成近正态样本（偏度≈0、超额峰度≈0）
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(n: number, seed: number): number[] {
  const next = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = 0; k < 12; k += 1) sum += next();
    out.push(sum - 6);
  }
  return out;
}

function exponentialSample(n: number, seed: number): number[] {
  const next = mulberry32(seed);
  return Array.from({ length: n }, () => -Math.log(Math.max(next(), 1e-12)));
}

describe('dagostinoPearson', () => {
  it('近正态样本（Irwin-Hall）：p 不拒绝', () => {
    const result = dagostinoPearson(normalSample(120, 7));
    expect(result).not.toBeNull();
    expect(result!.p).toBeGreaterThan(0.01);
  });

  it('指数样本（强右偏）：p 拒绝正态', () => {
    const result = dagostinoPearson(exponentialSample(120, 7));
    expect(result).not.toBeNull();
    expect(result!.p).toBeLessThan(0.001);
  });

  it('n<8 返回 null（检验不可靠）', () => {
    expect(dagostinoPearson([1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it('常数数组返回 p=1（无变异）', () => {
    const result = dagostinoPearson([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(result!.p).toBe(1);
  });
});

describe('significanceStars', () => {
  it('标准星级', () => {
    expect(significanceStars(0.0005)).toBe('***');
    expect(significanceStars(0.005)).toBe('**');
    expect(significanceStars(0.02)).toBe('*');
    expect(significanceStars(0.2)).toBe('ns');
    expect(significanceStars(null)).toBe('');
  });
});
