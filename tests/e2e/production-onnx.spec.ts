import { readdirSync } from 'node:fs';
import { expect, test } from 'playwright/test';

test('production worker loads local ONNX runtime assets and runs inference', async ({ page }) => {
  const worker = readdirSync('dist/assets').find((file) => /^analysis\.worker-.*\.js$/.test(file));
  expect(worker, 'production build must include the analysis worker').toBeTruthy();
  const runtimeResponses: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/ort/')) runtimeResponses.push({ url: response.url(), status: response.status() });
  });
  await page.goto('/');
  const result = await page.evaluate(async (workerFile) => {
    // Minimal ONNX model: a single Sigmoid, input/output float32 [1,1,3,5].
    const encoder = new TextEncoder();
    const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
    const varint = (value: number) => {
      const bytes: number[] = [];
      do { let byte = value & 127; value = Math.floor(value / 128); if (value) byte |= 128; bytes.push(byte); } while (value);
      return Uint8Array.from(bytes);
    };
    const integer = (field: number, value: number) => concat(varint(field * 8), varint(value));
    const message = (field: number, payload: Uint8Array | string) => {
      const bytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
      return concat(varint(field * 8 + 2), varint(bytes.length), bytes);
    };
    const valueInfo = () => message(2, message(1, concat(integer(1, 1), message(2, concat(...[1, 1, 3, 5].map((size) => message(1, integer(1, size))))))));
    const node = concat(message(1, 'x'), message(2, 'y'), message(4, 'Sigmoid'));
    const graph = concat(message(1, node), message(2, 'g'), message(11, concat(message(1, 'x'), valueInfo())), message(12, concat(message(1, 'y'), valueInfo())));
    const model = concat(integer(1, 8), message(2, 'test'), message(7, graph), message(8, concat(message(1, ''), integer(2, 13))));
    const pixels = new Uint8ClampedArray(5 * 3 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([95, 65, 40, 255], i);
    const workerInstance = new Worker(`/assets/${workerFile}`, { type: 'module' });
    return await new Promise<{ aiUsed: boolean; aiModelLoaded: string | null; warnings: string[] }>((resolve, reject) => {
      const timer = setTimeout(() => { workerInstance.terminate(); reject(new Error('Worker timed out')); }, 30_000);
      workerInstance.onerror = (event) => { clearTimeout(timer); workerInstance.terminate(); reject(new Error(event.message)); };
      workerInstance.onmessage = (event) => { clearTimeout(timer); workerInstance.terminate(); resolve(event.data); };
      workerInstance.postMessage({
        requestId: 1, pixels: new ImageData(pixels, 5, 3), rois: [], profileId: 'h_dab',
        threshold: { mode: 'auto', method: 'otsu', manualValue: 40, backgroundPercentile: 5, controlFalsePositiveRate: 0.001, controlThreshold: null, controlImageName: null },
        segmentation: { minAreaPx: 1, maxAreaPx: 1000, minCircularity: 0 }, calibration: { mpp: null },
        coloc: { channelA: 0, channelB: 1, thresholdMode: 'auto', manualA: 40, manualB: 40, backgroundPercentile: 5 },
        stainOverride: null, ai: { useAi: true, model: { name: 'test.onnx', bytes: model.buffer } },
      });
    });
  }, worker!);
  expect(result.aiUsed, JSON.stringify(result.warnings)).toBe(true);
  expect(result.aiModelLoaded).toBe('test.onnx');
  expect(result.warnings).toEqual([]);
  expect(runtimeResponses.some((response) => response.url.endsWith('.jsep.mjs') && response.status === 200)).toBe(true);
  expect(runtimeResponses.some((response) => response.url.endsWith('.jsep.wasm') && response.status === 200)).toBe(true);
});
