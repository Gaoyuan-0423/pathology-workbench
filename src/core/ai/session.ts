/**
 * ONNX 推理会话（Worker 内使用；动态导入 onnxruntime-web，wasm 走本地静态资产）。
 * 会话按模型文件名缓存；同一会话跨请求复用。
 */
import { inferPlaneSize, toModelTensor } from './prepost.ts';
import { ortAssetRoot } from './asset-root.ts';

interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

type OrtTensorConstructor = new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;

interface OrtModule {
  env: { wasm: { wasmPaths: string } };
  // session.run 只接受 ort.Tensor 实例：普通 { data, dims } 对象没有 location 等字段，
  // 会在 onnxruntime-web 内部抛 "invalid data location"。
  Tensor: OrtTensorConstructor;
  InferenceSession: {
    create(uriOrBuffer: Uint8Array, options?: Record<string, unknown>): Promise<OrtSession>;
  };
}

let cached: { name: string; session: OrtSession; Tensor: OrtTensorConstructor } | null = null;
let loading: Promise<OrtSession> | null = null;

export function cachedModelName(): string | null {
  return cached?.name ?? null;
}

export async function ensureSession(
  name: string,
  bytes: ArrayBuffer,
): Promise<OrtSession> {
  if (cached?.name === name) return cached.session;
  if (loading) return loading;
  loading = (async () => {
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule;
    // wasm/mjs 由 vite-plugin-static-copy 复制到 <base>ort/（离线，不走 CDN）
    ort.env.wasm.wasmPaths = ortAssetRoot(self.location.href);
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ['wasm'],
    });
    cached = { name, session, Tensor: ort.Tensor };
    return session;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export interface InferContext {
  width: number;
  height: number;
}

/**
 * 灰度图 → 概率图。
 * 输入布局：默认 [1,1,H,W]；若模型元数据声明 3 通道则复制为 3 通道；H/W 动态时用工作图尺寸。
 * 输出：取第一个输出；末两维与数据长度一致时按其 H×W，否则推断平面尺寸；缩放回工作图尺寸。
 * 注意：固定输入尺寸的模型会把整张工作图缩放到该尺寸（尚未分块推理）。
 */
export async function inferNucleiProb(
  gray: Float32Array,
  width: number,
  height: number,
): Promise<Float32Array> {
  if (!cached) throw new Error('AI 模型未加载');
  const { session, Tensor } = cached;

  let channels: 1 | 3 = 1;
  let modelW = width;
  let modelH = height;
  try {
    const metadata = (
      session as unknown as {
        inputMetadata?: ReadonlyArray<
          { shape?: ReadonlyArray<number | string>; dimensions?: ReadonlyArray<number | string> } | undefined
        >;
      }
    ).inputMetadata;
    // onnxruntime-web ≥1.22 的 TensorValueMetadata 字段名是 shape；保留 dimensions 兼容旧形态。
    const dims = metadata?.[0]?.shape ?? metadata?.[0]?.dimensions;
    if (dims && dims.length === 4) {
      const c = Number(dims[1]);
      if (c === 3) channels = 3;
      const w = Number(dims[3]);
      const h = Number(dims[2]);
      if (Number.isFinite(w) && w > 0) modelW = w;
      if (Number.isFinite(h) && h > 0) modelH = h;
    }
  } catch {
    // 元数据不可读：按动态 [1,1,H,W] 处理
  }

  const resized = resizeForModel(gray, width, height, modelW, modelH);
  const tensor = toModelTensor(resized, modelW, modelH, channels);
  const inputName = session.inputNames[0];
  // toModelTensor 按行优先（y*W+x）写入，对应 NCHW = [1, C, H, W]。
  const feeds = { [inputName]: new Tensor('float32', tensor, [1, channels, modelH, modelW]) };
  const outputs = await session.run(feeds);
  const output = outputs[session.outputNames[0]];
  const flat = output.data;
  const outDims = output.dims ?? [];
  const outH = Number(outDims[outDims.length - 2]);
  const outW = Number(outDims[outDims.length - 1]);
  if (outDims.length >= 3 && outH > 0 && outW > 0 && flat.length > outH * outW && flat.length % (outH * outW) === 0) {
    // 多通道输出（如背景/前景两类）无法确定哪一通道是细胞核；拒绝而不是静默混合各通道。
    throw new Error(
      `模型输出形状 [${outDims.join(',')}] 含 ${flat.length / (outH * outW)} 个通道；当前只支持单通道细胞核概率或 logit 输出`,
    );
  }
  // 输出形状可信时直接使用（如 [1,1,H,W]）；否则按长度推断平面尺寸。
  const plane = outDims.length >= 2 && outH > 0 && outW > 0 && outH * outW === flat.length
    ? { width: outW, height: outH }
    : inferPlaneSize(flat.length, modelW, modelH);
  const prob = resizeForModel(flat, plane.width, plane.height, width, height);
  return prob;
}

function resizeForModel(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  if (sw === dw && sh === dh) return src;
  // 复用 prepost 的双线性实现（避免循环依赖直接内联调用）
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
