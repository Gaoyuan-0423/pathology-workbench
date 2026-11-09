// 真实 onnxruntime-web 推理回归（不 mock ort）。
// 历史问题：session.run 收到普通 { data, dims } 对象（非 ort.Tensor）→ "invalid data location"，
// 且 dims 写成 [1,C,W,H]、模型元数据读错字段（dimensions 而非 shape），AI 路径从未真正运行，
// 每次静默回落 Otsu。session.test.ts mock 了 ort，因此无法发现。
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const ORT_DIST = pathToFileURL(dirname(require.resolve('onnxruntime-web'))).href + '/';
vi.mock('./asset-root.ts', () => ({ ortAssetRoot: () => ORT_DIST }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('location', { href: 'http://localhost/src/core/analysis.worker.ts' });
  vi.stubGlobal('self', globalThis);
});
afterEach(() => vi.unstubAllGlobals());

// ── 最小 ONNX protobuf 编码（测试内生成模型，不提交二进制文件） ──
const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
function varint(n: number): Uint8Array {
  const out: number[] = [];
  do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  return Uint8Array.from(out);
}
const tag = (field: number, wire: number) => varint(field * 8 + wire);
const vint = (field: number, n: number) => cat(tag(field, 0), varint(n));
const ld = (field: number, payload: Uint8Array | string) => {
  const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
  return cat(tag(field, 2), varint(bytes.length), bytes);
};
type Dim = number | string;
const valueInfo = (name: string, shape: Dim[]) => {
  const dims = cat(...shape.map((d) => ld(1, typeof d === 'number' ? vint(1, d) : ld(2, d))));
  return cat(ld(1, name), ld(2, ld(1, cat(vint(1, 1 /* FLOAT */), ld(2, dims)))));
};
/** 单算子模型 x → op → y（opset 13）。 */
function model(op: string, input: Dim[], output: Dim[], attribute?: Uint8Array): ArrayBuffer {
  const node = cat(ld(1, 'x'), ld(2, 'y'), ld(4, op), ...(attribute ? [ld(5, attribute)] : []));
  const graph = cat(ld(1, node), ld(2, 'g'), ld(11, valueInfo('x', input)), ld(12, valueInfo('y', output)));
  const bytes = cat(vint(1, 8), ld(2, 'wisplab-test'), ld(7, graph), ld(8, cat(ld(1, ''), vint(2, 13))));
  return bytes.buffer as ArrayBuffer;
}
const reduceChannelsAttr = cat(ld(1, 'axes'), vint(8, 1), vint(20, 7 /* INTS */));

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
/** 非均匀灰度，确保行列方向错误会体现在数值上。 */
const gradient = (w: number, h: number) => Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 256);

async function infer(bytes: ArrayBuffer, id: string, gray: Float32Array, w: number, h: number) {
  const { ensureSession, inferNucleiProb } = await import('./session.ts');
  await ensureSession(`${id}.onnx`, bytes);
  return inferNucleiProb(gray, w, h);
}

describe('ONNX 推理（真实 onnxruntime-web）', () => {
  it('固定非正方形输入 [1,1,H=3,W=5]：张量按 NCHW 传入并逐像素对应', async () => {
    const gray = gradient(5, 3);
    const prob = await infer(model('Sigmoid', [1, 1, 3, 5], [1, 1, 3, 5]), 'static', gray, 5, 3);
    expect(prob).toHaveLength(15);
    gray.forEach((v, i) => expect(prob[i]).toBeCloseTo(sigmoid(v / 255), 6));
  });

  it('动态 H/W：按工作图尺寸推理', async () => {
    const gray = gradient(7, 4);
    const prob = await infer(model('Sigmoid', [1, 1, 'H', 'W'], [1, 1, 'H', 'W']), 'dynamic', gray, 7, 4);
    expect(prob).toHaveLength(28);
    gray.forEach((v, i) => expect(prob[i]).toBeCloseTo(sigmoid(v / 255), 6));
  });

  it('读取 inputMetadata.shape：声明 3 通道输入时复制为 3 通道', async () => {
    const gray = gradient(6, 4);
    const bytes = model('ReduceMean', [1, 3, 4, 6], [1, 1, 4, 6], reduceChannelsAttr);
    const prob = await infer(bytes, 'three-channel', gray, 6, 4);
    gray.forEach((v, i) => expect(prob[i]).toBeCloseTo(v / 255, 6));
  });

  it('固定尺寸小于工作图时缩放输入并把输出缩放回工作图尺寸', async () => {
    const prob = await infer(model('Sigmoid', [1, 1, 3, 5], [1, 1, 3, 5]), 'resize', gradient(10, 6), 10, 6);
    expect(prob).toHaveLength(60);
    prob.forEach((p) => { expect(p).toBeGreaterThanOrEqual(0.5); expect(p).toBeLessThanOrEqual(sigmoid(1)); });
  });

  it('多通道输出无法确定细胞核通道时明确报错，而不是混合各通道', async () => {
    const bytes = model('Sigmoid', [1, 3, 4, 6], [1, 3, 4, 6]);
    await expect(infer(bytes, 'multi-output', gradient(6, 4), 6, 4)).rejects.toThrow('单通道');
  });
});
