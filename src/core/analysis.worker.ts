/**
 * 分析 Worker：薄壳。AI 会话与 ImageData 包装在此，
 * 纯管线在 core/analysis/engine.ts（与程序化 API 共用同一实现）。
 * 通过 requestId 丢弃过期结果；UI 持有最新请求即可。
 */
import { buildStainMatrix, extractStainChannel } from './image/color.ts';
import { analyzeColocImage, analyzeStainImage } from './analysis/engine.ts';
import { probToMask } from './ai/prepost.ts';
import { ensureSession, cachedModelName, inferNucleiProb } from './ai/session.ts';
import { getStainProfile } from './types.ts';
import type {
  AnalysisResult,
  Calibration,
  ColocConfig,
  Roi,
  SegmentationConfig,
  StainProfileId,
  ThresholdConfig,
  Vec3,
} from './types.ts';

export interface AnalysisRequest {
  requestId: number;
  pixels: ImageData;
  rois: Roi[];
  profileId: StainProfileId;
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  calibration: Calibration;
  coloc: ColocConfig;
  stainOverride: [Vec3, Vec3] | null;
  ai: { useAi: boolean; model: { name: string; bytes: ArrayBuffer } | null };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
}

const workerSelf = self as unknown as WorkerScope & {
  postMessage: (message: AnalysisResult) => void;
};

workerSelf.onmessage = async (event) => {
  const request = event.data;
  const result = request.profileId === 'if_coloc'
    ? runColoc(request)
    : await runStain(request);
  workerSelf.postMessage(result);
};

function runColoc(request: AnalysisRequest): AnalysisResult {
  const engine = analyzeColocImage(request.pixels, request.coloc);
  return {
    requestId: request.requestId,
    overall: engine.overall,
    perRoi: [],
    thresholdUsed: engine.coloc.thresholdA,
    nuclearThresholdUsed: engine.coloc.thresholdB,
    backgroundLevel: engine.coloc.backgroundA,
    overlay: new ImageData(
      new Uint8ClampedArray(engine.overlayRgba),
      request.pixels.width,
      request.pixels.height,
    ),
    coloc: engine.coloc,
    aiUsed: false,
    aiModelLoaded: null,
    warnings: engine.warnings,
  };
}

async function runStain(request: AnalysisRequest): Promise<AnalysisResult> {
  const warnings: string[] = [];
  let aiMask: Uint8Array | null = null;
  let aiUsed = false;
  let aiModelLoaded: string | null = cachedModelName();

  if (request.ai?.useAi) {
    try {
      if (request.ai.model && cachedModelName() !== request.ai.model.name) {
        aiModelLoaded = null;
        await ensureSession(request.ai.model.name, request.ai.model.bytes);
      }
      // 核分割源：第一染色通道（0–255），与引擎取法一致
      const profile = getStainProfile(request.profileId);
      const pair = request.stainOverride ?? profile.stains!;
      let matrixPair = pair;
      let matrix: ReturnType<typeof buildStainMatrix>;
      try {
        matrix = buildStainMatrix(matrixPair[0], matrixPair[1]);
      } catch {
        matrixPair = profile.stains!;
        matrix = buildStainMatrix(matrixPair[0], matrixPair[1]);
      }
      const nuclearSource = extractStainChannel(request.pixels, matrix, 0);
      const prob = await inferNucleiProb(nuclearSource, request.pixels.width, request.pixels.height);
      aiMask = probToMask(prob, 0.5);
      aiUsed = true;
      aiModelLoaded = cachedModelName();
    } catch (error) {
      warnings.push(`AI 核分割失败，已回落 Otsu：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const engine = analyzeStainImage({
    pixels: request.pixels,
    rois: request.rois,
    profileId: request.profileId,
    threshold: request.threshold,
    segmentation: request.segmentation,
    calibration: request.calibration,
    stainOverride: request.stainOverride,
    aiMask,
  });

  return {
    requestId: request.requestId,
    overall: engine.overall,
    perRoi: engine.perRoi,
    thresholdUsed: engine.thresholdUsed,
    nuclearThresholdUsed: engine.nuclearThresholdUsed,
    backgroundLevel: engine.backgroundLevel,
    overlay: new ImageData(
      new Uint8ClampedArray(engine.overlayRgba),
      request.pixels.width,
      request.pixels.height,
    ),
    coloc: null,
    aiUsed,
    aiModelLoaded,
    warnings: [...warnings, ...engine.warnings],
  };
}
