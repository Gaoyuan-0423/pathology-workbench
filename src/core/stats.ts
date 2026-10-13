// 统计数值实现：Welch t 检验、单因素 ANOVA、Dunnett 多重比较（自 pcr-workbench 移植），
// 以及本项目的 Mann-Whitney U、Kruskal-Wallis、Levene(Brown–Forsythe)、
// Bonferroni/Holm 校正与 D'Agostino–Pearson 正态性检验。
// p 值经由正则化不完全 beta 函数（Lanczos lgamma + 连分式），对照标准统计表验证。

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 样本标准差（n-1）；n<2 返回 NaN。 */
export function sd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (n - 1));
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全贝塔函数 I_x(a, b)。 */
export function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Student t 分布的单侧累积概率 P(T ≤ t)。 */
export function studentTCdf(t: number, df: number): number {
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const p = 0.5 * betaInc(df / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}

/** F 分布的累积概率 P(F ≤ f)。 */
export function fCdf(f: number, df1: number, df2: number): number {
  if (f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  const x = (df1 * f) / (df1 * f + df2);
  return betaInc(df1 / 2, df2 / 2, x);
}

export interface TTestResult {
  t: number;
  df: number;
  p: number;
}

/** Welch t 检验（双侧，方差不齐），返回 t 统计量、Welch–Satterthwaite 自由度与 p 值。 */
export function welchTTest(a: number[], b: number[]): TTestResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 2 || n2 < 2) return { t: NaN, df: NaN, p: NaN };
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = sd(a) ** 2;
  const v2 = sd(b) ** 2;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (!Number.isFinite(se) || se === 0) return { t: 0, df: n1 + n2 - 2, p: 1 };
  const t = (m1 - m2) / se;
  const num = (v1 / n1 + v2 / n2) ** 2;
  const den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = den > 0 ? num / den : n1 + n2 - 2;
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { t, df, p: Math.min(1, Math.max(0, p)) };
}

export interface AnovaResult {
  f: number;
  df1: number;
  df2: number;
  p: number;
  /** 组内均方（MSE），供 Dunnett 的合并标准差使用 */
  msWithin: number;
}

/** 单因素 ANOVA；组数 <2 或总样本 ≤ 组数时返回 NaN。 */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length;
  const n = gs.reduce((s, g) => s + g.length, 0);
  if (k < 2 || n <= k) return { f: NaN, df1: NaN, df2: NaN, p: NaN, msWithin: NaN };
  const all = gs.flat();
  const grand = mean(all);
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    const m = mean(g);
    ssb += g.length * (m - grand) * (m - grand);
    for (const x of g) ssw += (x - m) * (x - m);
  }
  const df1 = k - 1;
  const df2 = n - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  if (msw === 0) return { f: 0, df1, df2, p: 1, msWithin: 0 };
  const f = msb / msw;
  const p = 1 - fCdf(f, df1, df2);
  return { f, df1, df2, p: Math.min(1, Math.max(0, p)), msWithin: msw };
}

export function significanceStars(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

export function formatP(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '-';
  if (p < 0.0001) return '<0.0001';
  return p.toFixed(4);
}

// ── Dunnett 多重比较（与共用对照）──

/** 误差函数（Abramowitz–Stegun 7.1.26，|err| ≤ 1.5e-7）。 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** 正则化下不完全伽马函数 P(a, x)（级数 + 连分式）。 */
export function lowerGammaInc(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // 级数
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  // 连分式（Lentoni），计算 Q 再取 1-Q
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  return 1 - q;
}

/** 卡方分布累积概率。 */
export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 0;
  return lowerGammaInc(df / 2, x / 2);
}

/** 卡方分布分位数（二分法）。 */
export function chiSquareQuantile(q: number, df: number): number {
  if (q <= 0) return 0;
  if (q >= 1) return Infinity;
  let lo = 0;
  let hi = df * 60 + 200;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, df) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface GLNode {
  x: number;
  w: number;
}

/** Gauss–Legendre 节点与权重（牛顿迭代求 Legendre 多项式零点）。 */
export function gaussLegendre(n: number, a: number, b: number): GLNode[] {
  const nodes: GLNode[] = [];
  const m = (n + 1) / 2;
  for (let i = 1; i <= m; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    const xl = (b - a) / 2;
    const xm = (a + b) / 2;
    const w = (2 * xl) / ((1 - z * z) * pp * pp);
    nodes.push({ x: xm - xl * z, w });
    nodes.push({ x: xm + xl * z, w });
  }
  return nodes;
}

const GL_N_U = gaussLegendre(40, -9, 9); // 对照组潜变量
const GL_N_S = gaussLegendre(40, 0, 1); // 卡方分位数坐标

/**
 * Dunnett 校正 p 值（双侧，共用对照组）。
 * 输入每个处理组 vs 对照组的 |t| 与 b_j = sqrt(n_j / n_0)，以及混合自由度 df。
 * 通过二元高斯求积对多元 t 的最大绝对值分布积分（Dunnett 1955/1989 的单因子结构）。
 */
export function dunnettAdjustedP(
  comparisons: { b: number; tAbs: number }[],
  df: number,
): number[] {
  const k = comparisons.length;
  if (k === 0 || df <= 0) return comparisons.map(() => NaN);
  const out: number[] = new Array(k).fill(0);
  // S = σ·√(χ²_ν/ν) 服从 χ 分布：按分位数坐标预积分离散化
  const sNodes = GL_N_S.map((ns) => ({ w: ns.w, s: Math.sqrt(chiSquareQuantile(ns.x, df) / df) }));
  for (let i = 0; i < k; i++) {
    const c = comparisons[i].tAbs;
    if (!Number.isFinite(c)) {
      out[i] = NaN;
      continue;
    }
    let acc = 0;
    for (const nu of GL_N_U) {
      let inner = 0;
      for (const ns of sNodes) {
        const s = ns.s;
        let prod = 1;
        for (const cmp of comparisons) {
          // 条件分布：Φ(cS√(1+b²)+bu) − Φ(−cS√(1+b²)+bu)
          const r = Math.sqrt(1 + cmp.b * cmp.b);
          const a = s * c * r;
          const off = cmp.b * nu.x;
          prod *= normalCdf(a + off) - normalCdf(-a + off);
          if (prod === 0) break;
        }
        inner += ns.w * prod;
      }
      acc += nu.w * normalPdf(nu.x) * inner;
    }
    out[i] = Math.min(1, Math.max(0, 1 - acc));
  }
  return out;
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ── Mann–Whitney U（正态近似 + 结校正；双侧）──

export interface MannWhitneyResult {
  u: number;
  z: number;
  p: number;
}

function rankAverage(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Mann–Whitney U 检验；任一组为空返回 NaN。样本量建议每组 ≥8（正态近似）。 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { u: NaN, z: NaN, p: NaN };
  const ranks = rankAverage([...a, ...b]);
  let rankSumA = 0;
  for (let i = 0; i < n1; i += 1) rankSumA += ranks[i];
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = (n1 * n2) - u1;
  const u = Math.min(u1, u2);
  // 结校正
  const all = [...a, ...b].sort((x, y) => x - y);
  let ties = 0;
  let run = 1;
  for (let i = 1; i <= all.length; i += 1) {
    if (i < all.length && all[i] === all[i - 1]) run += 1;
    else {
      if (run > 1) ties += run ** 3 - run;
      run = 1;
    }
  }
  const n = n1 + n2;
  const variance = (n1 * n2 / 12) * ((n + 1) - ties / (n * (n - 1)));
  if (variance <= 0) return { u, z: 0, p: 1 };
  const meanU = (n1 * n2) / 2;
  const z = (u - meanU) / Math.sqrt(variance);
  const p = 2 * normalCdf(z);
  return { u, z, p: Math.min(1, Math.max(0, p)) };
}

// ── Kruskal–Wallis H（卡方近似 + 结校正）──

export interface KruskalWallisResult {
  h: number;
  df: number;
  p: number;
}

export function kruskalWallis(groups: number[][]): KruskalWallisResult {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length;
  const n = gs.reduce((sum, g) => sum + g.length, 0);
  if (k < 2 || n <= k) return { h: NaN, df: NaN, p: NaN };
  const ranks = rankAverage(gs.flat());
  let cum = 0;
  let rankSumSqOverN = 0;
  for (const g of gs) {
    let sum = 0;
    for (let i = 0; i < g.length; i += 1) sum += ranks[cum + i];
    rankSumSqOverN += (sum * sum) / g.length;
    cum += g.length;
  }
  // 结校正
  const all = gs.flat().sort((x, y) => x - y);
  let ties = 0;
  let run = 1;
  for (let i = 1; i <= all.length; i += 1) {
    if (i < all.length && all[i] === all[i - 1]) run += 1;
    else {
      if (run > 1) ties += run ** 3 - run;
      run = 1;
    }
  }
  const tieFactor = ties > 0 ? 1 - ties / (n * n * n - n) : 1;
  const h = (12 / (n * (n + 1))) * rankSumSqOverN - 3 * (n + 1);
  const hCorrected = h / tieFactor;
  const df = k - 1;
  const p = 1 - chiSquareCdf(hCorrected, df);
  return { h: hCorrected, df, p: Math.min(1, Math.max(0, p)) };
}

// ── Levene / Brown–Forsythe 方差齐性（中位数中心化，稳健）──

export interface LeveneResult {
  f: number;
  df1: number;
  df2: number;
  p: number;
}

export function leveneTest(groups: number[][]): LeveneResult {
  const gs = groups.filter((g) => g.length >= 2);
  const k = gs.length;
  if (k < 2) return { f: NaN, df1: NaN, df2: NaN, p: NaN };
  // 中位数中心化（Brown–Forsythe）
  const deviations = gs.map((g) => {
    const sorted = [...g].sort((x, y) => x - y);
    const mid = sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return g.map((value) => Math.abs(value - mid));
  });
  const anova = oneWayAnova(deviations);
  return { f: anova.f, df1: anova.df1, df2: anova.df2, p: anova.p };
}

// ── 多重比较校正 ──

/** Bonferroni：p·m，上限 1 */
export function bonferroni(ps: number[]): number[] {
  const m = ps.length;
  return ps.map((p) => (Number.isFinite(p) ? Math.min(1, p * m) : NaN));
}

/** Holm step-down：按 p 升序逐级乘 (m−i)，保持单调与原顺序 */
export function holm(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m).fill(NaN);
  let prev = 0;
  for (let i = 0; i < order.length; i += 1) {
    const value = Math.min(1, Math.max(prev, order[i].p * (m - i)));
    adjusted[order[i].index] = value;
    prev = value;
  }
  return adjusted;
}

// ── D'Agostino–Pearson K² 正态性检验（偏度 + 峰度联合，χ²₂）──
// D'Agostino 1970（偏度 Z）+ Anscombe & Glynn 1983（峰度 Z）。建议 n ≥ 8。

export interface NormalityResult {
  statistic: number;
  p: number;
}

export function dagostinoPearson(xs: number[]): NormalityResult | null {
  const n = xs.length;
  if (n < 8) return null;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (m2 === 0) return { statistic: 0, p: 1 };
  const g1 = m3 / m2 ** 1.5; // 偏度（带符号）
  const b2 = m4 / m2 ** 2; // 非 Fisher 峰度（Pearson b2）

  // 偏度 Z（D'Agostino 1970）
  const y = g1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 =
    (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) /
    ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(0.5 * Math.log(w2));
  const alpha = Math.sqrt(2 / (w2 - 1));
  const ratio = y / alpha;
  const zSkew = delta * Math.log(ratio + Math.sqrt(ratio * ratio + 1));

  // 峰度 Z（Anscombe–Glynn 1983 变换；矩用 Pearson b2 在正态下的精确矩
  // E[b2] = 3(n−1)/(n+1)、Var[b2] = 24n(n−2)(n−3)/((n+1)²(n+3)(n+5))）
  const eB2 = (3 * (n - 1)) / (n + 1);
  const varB2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) ** 2 * (n + 3) * (n + 5));
  const x = (b2 - eB2) / Math.sqrt(varB2);
  const sqrtBeta1 =
    ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) *
    Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const aBig = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
  const term1 = 1 - 2 / (9 * aBig);
  const denom = 1 + x * Math.sqrt(2 / (aBig - 4));
  const term2 = Math.sign(denom || 1) * Math.cbrt(term1 / (Math.abs(denom) || 1e-300));
  const zKurt = (term1 - term2) / Math.sqrt(2 / (9 * aBig));

  const k2 = zSkew * zSkew + zKurt * zKurt;
  // χ²₂ 生存函数 = exp(−x/2)
  const p = Math.exp(-k2 / 2);
  return { statistic: k2, p: Math.min(1, Math.max(0, p)) };
}
