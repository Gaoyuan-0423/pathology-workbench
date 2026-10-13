/**
 * 主线程侧的分析客户端：持有唯一 Worker，按 requestId 对齐响应，过期结果直接丢弃。
 */
import type { AnalysisResult } from './types.ts';
import type { AnalysisRequest } from './analysis.worker.ts';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, (result: AnalysisResult) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<AnalysisResult>) => {
    const resolve = pending.get(event.data.requestId);
    if (resolve) {
      pending.delete(event.data.requestId);
      resolve(event.data);
    }
  };
  return worker;
}

export function runAnalysis(
  pixels: ImageData,
  rois: AnalysisRequest['rois'],
  threshold: AnalysisRequest['threshold'],
  segmentation: AnalysisRequest['segmentation'],
): Promise<AnalysisResult> {
  const requestId = nextRequestId;
  nextRequestId += 1;
  const promise = new Promise<AnalysisResult>((resolve) => {
    pending.set(requestId, resolve);
  });
  ensureWorker().postMessage({ requestId, pixels, rois, threshold, segmentation });
  return promise;
}
