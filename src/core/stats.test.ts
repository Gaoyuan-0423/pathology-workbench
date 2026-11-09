import { describe, expect, it } from 'vitest';
import {
  bonferroni,
  dagostinoPearson,
  holm,
  kruskalWallis,
  leveneTest,
  mannWhitneyU,
  oneWayAnova,
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

  // Reference: scipy 1.15.2 scipy.stats.normaltest (D'Agostino–Pearson K²) on these literal values.
  const SCIPY_NORMALTEST = [
    { name: 'n=8 minimum', xs: [8.925, 9.698, 10.704, 10.752, 10.192, 10.924, 10.277, 8.615], statistic: 1.2955075779952052, p: 0.5232197196967104 },
    { name: 'n=12 near-normal', xs: [0.594, 1.155, -0.208, -2.03, 0.011, -0.647, -0.472, 1.055, 0.419, 0.302, 0.767, -0.217], statistic: 5.096487072745382, p: 0.07821893412538633 },
    { name: 'n=20 normal', xs: [5.961, 5.193, 5.386, 5.616, 7.548, 3.323, 6.203, 5.088, 4.758, 4.523, 2.569, 9.27, 4.624, 8.169, 6.917, 5.422, 6.281, 7.789, 6.323, 6.473], statistic: 0.3357054902490522, p: 0.8454783263240921 },
    { name: 'n=25 uniform (platykurtic)', xs: [0.232, 0.834, 0.412, 0.159, 0.105, 0.729, 0.571, 0.692, 0.637, 0.216, 0.485, 0.449, 0.602, 0.919, 0.367, 0.78, 0.266, 0.763, 0.624, 0.796, 0.649, 0.696, 0.421, 0.613, 0.915], statistic: 1.9384729932242262, p: 0.37937257980625133 },
    { name: 'n=40 exponential (skewed)', xs: [1.305, 0.004, 0.996, 0.142, 0.44, 1.196, 0.529, 0.434, 0.815, 0.055, 0.429, 0.001, 0.86, 1.373, 2.333, 2.836, 0.751, 0.145, 1.752, 0.555, 2.455, 1.96, 0.187, 0.065, 1.442, 0.027, 0.096, 0.717, 0.192, 0.243, 0.506, 1.175, 0.214, 0.483, 1.642, 1.173, 0.073, 1.298, 0.109, 0.96], statistic: 7.40043737010948, p: 0.024718120395735264 },
    { name: 'n=50 t3 (heavy tails)', xs: [-0.675, 1.005, 0.593, -0.04, 1.092, -1.083, 0.009, -1.223, 15.505, 0.885, 0.821, -1.076, -2.151, -0.629, 0.755, 1.756, 0.118, -0.577, 0.305, 0.69, 1.656, -1.305, -0.598, 0.613, 2.279, 1.361, 1.052, 3.201, -0.731, -1.161, 4.002, 1.772, -0.322, 1.083, -1.201, -1.183, -0.532, 0.428, 0.394, 1.64, 0.241, 0.645, 4.103, -2.971, -0.012, 1.561, -0.767, -0.761, -0.711, 0.255], statistic: 76.75487187469913, p: 2.152243192429566e-17 },
  ];

  for (const ref of SCIPY_NORMALTEST) {
    it(`K² 与 p 与 scipy normaltest 一致：${ref.name}`, () => {
      const result = dagostinoPearson(ref.xs)!;
      expect(Math.abs(result.statistic - ref.statistic)).toBeLessThan(1e-9 * Math.max(1, ref.statistic));
      expect(Math.abs(result.p - ref.p)).toBeLessThan(1e-9 * ref.p);
    });
  }
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

// Reference: scipy 1.15.2 — ttest_ind(equal_var=False), f_oneway, kruskal, levene(center='median').
// 深尾部用例防止 p 经 1 − cdf 相消成 0。
const SCIPY_TWO_SAMPLE = [
  {name: "unequal var n=8/10", a: [12.1, 13.4, 11.8, 14.2, 12.9, 13.1, 12.4, 13.8], b: [15.2, 18.9, 14.1, 20.3, 16.7, 17.5, 13.9, 19.4, 16.1, 18.2], t: -5.355802263087208, p: 0.0001726607883052276},
  {name: "small n=4/5", a: [1.02, 0.95, 1.1, 0.98], b: [1.45, 1.62, 1.38, 1.71, 1.55], t: -7.8843456743402704, p: 0.00020914965482157148},
  {name: "ties n=9/9", a: [3, 4, 4, 5, 5, 5, 6, 7, 8], b: [5, 6, 6, 7, 7, 8, 8, 9, 10], t: -2.848220418184273, p: 0.011624801525705183},
  {name: "large effect n=12/12", a: [0.1, 0.12, 0.09, 0.11, 0.13, 0.1, 0.08, 0.12, 0.11, 0.1, 0.09, 0.12], b: [0.31, 0.29, 0.35, 0.33, 0.3, 0.36, 0.28, 0.34, 0.32, 0.31, 0.37, 0.3], t: -23.16566424689782, p: 4.0702762933110433e-14},
  {name: "deep tail n=8/8", a: [0.1, 0.12, 0.09, 0.11, 0.13, 0.1, 0.08, 0.12], b: [0.31, 0.29, 0.35, 0.33, 0.3, 0.36, 0.28, 0.34], t: -17.897596030248636, p: 1.4000762310111736e-09},
];

const SCIPY_MULTI_GROUP = [
  {name: "3 groups n=6", groups: [[4.2, 4.8, 5.1, 4.5, 4.9, 5.3], [5.9, 6.4, 6.1, 5.7, 6.8, 6.2], [4.4, 5.0, 4.7, 5.2, 4.6, 4.9]], anovaF: 29.165961049957673, anovaP: 6.776203339484556e-06, kwH: 11.383092286501375, kwP: 0.0033743716719940465, leveneF: 0.16883116883116883, leveneP: 0.8462343491272545},
  {name: "4 groups unequal n", groups: [[10, 12, 11, 13], [14, 15, 13, 16, 17], [11, 12, 12, 13, 14, 12], [18, 20, 19]], anovaF: 25.42288557213931, anovaP: 6.304719420304369e-06, kwH: 13.014603008044773, kwP: 0.0046051317837134485, leveneF: 0.5849952516619181, leveneP: 0.6346756423168582},
  {name: "3 groups heavy ties", groups: [[1, 1, 2, 2, 2, 3], [2, 3, 3, 3, 4, 4], [3, 4, 4, 5, 5, 5]], anovaF: 15.648148148148149, anovaP: 0.00021334750902671294, kwH: 11.618506493506496, kwP: 0.00299966924891639, leveneF: 0.21739130434782594, leveneP: 0.8071059800854483},
  {name: "3 groups tiny differences", groups: [[100.1, 100.3, 99.8, 100.0, 100.2], [100.2, 100.0, 100.4, 99.9, 100.1], [100.0, 100.3, 100.1, 99.7, 100.2]], anovaF: 0.11023622047245102, anovaP: 0.8965190050668456, kwH: 0.06654478976233771, kwP: 0.9672750429299903, leveneF: 0.040816326530608175, leveneP: 0.9601381276398205},
  {name: "deep tail 3\u00d78", groups: [[0.1, 0.12, 0.09, 0.11, 0.13, 0.1, 0.08, 0.12], [0.31, 0.29, 0.35, 0.33, 0.3, 0.36, 0.28, 0.34], [0.52, 0.49, 0.55, 0.5, 0.53, 0.48, 0.51, 0.54]], anovaF: 576.1753846153891, anovaP: 4.511386541797749e-19, kwH: 20.497824194952138, kwP: 3.539598729577977e-05, leveneF: 2.1457286432160823, leveneP: 0.14193095593332059},
  {name: "deep tail 3\u00d740 KW", groups: [[0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39], [1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.2, 1.21, 1.22, 1.23, 1.24, 1.25, 1.26, 1.27, 1.28, 1.29, 1.3, 1.31, 1.32, 1.33, 1.34, 1.35, 1.36, 1.37, 1.38, 1.39], [2.0, 2.01, 2.02, 2.03, 2.04, 2.05, 2.06, 2.07, 2.08, 2.09, 2.1, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.2, 2.21, 2.22, 2.23, 2.24, 2.25, 2.26, 2.27, 2.28, 2.29, 2.3, 2.31, 2.32, 2.33, 2.34, 2.35, 2.36, 2.37, 2.38, 2.39]], anovaF: 2926.829268292702, anovaP: 1.2347305530948768e-100, kwH: 105.78512396694214, kwP: 1.0691833741861901e-23, leveneF: 0.0, leveneP: 1.0},
];

const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.abs(expected) + 1e-15);

describe('与 scipy 金标准一致', () => {
  for (const ref of SCIPY_TWO_SAMPLE) {
    it(`Welch t：${ref.name}`, () => {
      const r = welchTTest(ref.a, ref.b);
      close(r.t, ref.t);
      close(r.p, ref.p);
      expect(r.p).toBeGreaterThan(0);
    });
  }
  for (const ref of SCIPY_MULTI_GROUP) {
    it(`ANOVA / Kruskal–Wallis / Levene：${ref.name}`, () => {
      const anova = oneWayAnova(ref.groups);
      close(anova.f, ref.anovaF);
      close(anova.p, ref.anovaP);
      const kw = kruskalWallis(ref.groups);
      close(kw.h, ref.kwH);
      close(kw.p, ref.kwP);
      const lev = leveneTest(ref.groups);
      close(lev.f, ref.leveneF);
      close(lev.p, ref.leveneP);
      expect(anova.p).toBeGreaterThan(0);
      expect(kw.p).toBeGreaterThan(0);
    });
  }
});
