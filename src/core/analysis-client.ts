/**
 * 主线程侧的分析客户端：持有唯一 Worker，按 requestId 对齐成功/失败响应。
 * 当前输入与迟到响应的有效性由 analysis-validity 和调用方检查。
 */
import type { AnalysisResult, Calibration, ColocConfig, Roi, SegmentationConfig, StainProfileId, ThresholdConfig, Vec3 } from './types.ts';
import type { AnalysisRequest, AnalysisResponse } from './analysis.worker.ts';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (result: AnalysisResult) => void; reject: (error: Error) => void }>();

function failWorker(message: string): void {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  const owner = worker;
  worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
    if (worker !== owner) return;
    const request = pending.get(event.data.requestId);
    if (request) {
      pending.delete(event.data.requestId);
      if ('error' in event.data) request.reject(new Error(event.data.error));
      else request.resolve(event.data);
    }
  };
  worker.onerror = (event) => { event.preventDefault(); if (worker === owner) failWorker(event.message || '分析线程失败'); };
  worker.onmessageerror = () => { if (worker === owner) failWorker('分析响应无法读取'); };
  return worker;
}

export function runAnalysis(
  pixels: ImageData,
  rois: Roi[],
  profileId: StainProfileId,
  threshold: ThresholdConfig,
  segmentation: SegmentationConfig,
  calibration: Calibration,
  coloc: ColocConfig,
  stainOverride: [Vec3, Vec3] | null,
  ai: AnalysisRequest['ai'],
): Promise<AnalysisResult> {
  const requestId = nextRequestId;
  nextRequestId += 1;
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });
  const request: AnalysisRequest = {
    requestId,
    pixels,
    rois,
    profileId,
    threshold,
    segmentation,
    calibration,
    coloc,
    stainOverride,
    ai,
  };
  try {
    ensureWorker().postMessage(request);
  } catch (error) {
    pending.get(requestId)?.reject(error instanceof Error ? error : new Error(String(error)));
    pending.delete(requestId);
  }
  return promise;
}
