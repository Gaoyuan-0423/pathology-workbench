import { expect, test, type Page } from 'playwright/test';
import { createHash } from 'node:crypto';
import { createSyntheticHdabPng } from './fixture.ts';

/** Control delivery, not the UI: lets the browser exercise debounce, late replies,
 * snapshots and exports deterministically. Existing smoke tests use the real worker.
 */
async function controlledWorker(page: Page) {
  // The suite header normally owns this registration surface. Keep its adapter
  // handshake local to the test, without loading authentication/network UI.
  await page.route('**/platform/wisplab.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    const host = window as any;
    host.__requests = [];
    host.WispLab = { registerProjectAdapter(adapter: unknown) { host.__projectAdapter = adapter; } };
    host.Worker = class {
      onmessage: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage(request: any) { host.__requests.push({ request, worker: this }); }
      terminate() {}
    };
    host.__reply = (index: number, error?: string) => {
      const { request, worker } = host.__requests[index];
      const overall = { roiId: null, roiName: '整图', pixelCount: 100, positiveFraction: 0.2,
        positiveNuclei: 2, totalNuclei: 10, labelingIndex: 0.2, integratedOpticalDensity: 100 + index,
        meanOpticalDensity: 5, borderNuclei: 0, estimatedTotalCount: 10, densityPerMm2: null, hScore: 20 };
      worker.onmessage({ data: error ? { requestId: request.requestId, error } : {
        requestId: request.requestId, overall, perRoi: [], thresholdUsed: 40 + index,
        nuclearThresholdUsed: 30, backgroundLevel: 0, overlay: null, coloc: null, qc: null,
        aiUsed: request.ai.useAi, aiRequested: request.ai.useAi,
        aiModelLoaded: request.ai.useAi ? request.ai.model?.name : null,
        aiModelId: request.ai.useAi ? request.ai.model?.id : null, warnings: [],
      } });
    };
  });
}
const report = (page: Page) => page.evaluate(() => (window as any).__pathologyAPI.getReportJson());
const requests = async (page: Page, count: number) => expect.poll(() => page.evaluate(() => (window as any).__requests.length)).toBe(count);
const reply = (page: Page, index: number, error?: string) => page.evaluate(({ index, error }) => (window as any).__reply(index, error), { index, error });
async function upload(page: Page) {
  await page.setInputFiles('.dropzone input[type="file"]', { name: 'synthetic.png', mimeType: 'image/png', buffer: createSyntheticHdabPng(100, 100).buffer });
  await requests(page, 1); await reply(page, 0);
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
}

test('parameter changes immediately withhold display, report, Methods, sample save and project result; late replies and failure stay unavailable', async ({ page }) => {
  await controlledWorker(page); await page.goto('/?lang=zh'); await upload(page);
  await page.getByPlaceholder('μm/px（可选）').fill('0.5');
  const pending = await report(page);
  expect(pending.analysisStatus).toBe('pending');
  expect(pending.parameters.calibration.mpp).toBe(0.5);
  expect(pending.metrics).toBeNull();
  expect(pending.methods.zh).toContain('尚无有效分析结果');
  await expect(page.locator('.result-overall')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加入样本', exact: true })).toBeDisabled();

  const snapshot = await page.evaluate(async () => {
    const { blob } = await (window as any).__projectAdapter.exportProject();
    const { importPathologyProject } = await import('/src/project-io.ts');
    const restored = await importPathologyProject(blob);
    return { result: restored.project.restoredAnalysis, mpp: restored.project.calibration.mpp };
  });
  expect(snapshot).toEqual({ result: null, mpp: 0.5 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告 JSON', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.metrics).toEqual({});
  expect(exported.methods.en).toContain('No valid analysis result');

  await requests(page, 2);
  await page.getByPlaceholder('μm/px（可选）').fill('0.75');
  await requests(page, 3);
  await reply(page, 1); // old response must not revive a result
  expect((await report(page)).metrics).toBeNull();
  await reply(page, 2);
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
  expect((await report(page)).metrics.integratedOpticalDensity).toBe(102);
  await page.getByRole('button', { name: '加入样本', exact: true }).click();
  // Saving now binds the measurement to the asynchronously hashed source bytes.
  await expect.poll(async () => (await report(page)).samples.length).toBe(1);
  await page.getByPlaceholder('μm/px（可选）').fill('1');
  await requests(page, 4); await reply(page, 3, 'controlled failure');
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('failed');
  expect((await report(page)).metrics).toBeNull();
  expect((await report(page)).samples[0].metrics.integratedOpticalDensity).toBe(102);
  await expect(page.getByRole('button', { name: '加入样本', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新分析', exact: true }).click();
  await requests(page, 5); await reply(page, 4);
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
});

test('same-name model replacements and AI toggles bind to content identity in the English UI', async ({ page }) => {
  await controlledWorker(page); await page.goto('/?lang=en'); await upload(page);
  const modelA = Buffer.from([1, 2, 3]), modelB = Buffer.from([1, 2, 4]);
  const aiInput = page.locator('input[type="file"][accept=".onnx"]');
  await aiInput.setInputFiles({ name: 'same.onnx', mimeType: 'application/octet-stream', buffer: modelA });
  await requests(page, 2);
  await aiInput.setInputFiles({ name: 'same.onnx', mimeType: 'application/octet-stream', buffer: modelB });
  await requests(page, 3);
  expect((await report(page)).metrics).toBeNull();
  await reply(page, 1);
  expect((await report(page)).metrics).toBeNull();
  await reply(page, 2);
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
  const modelId = createHash('sha256').update(modelB).digest('hex');
  expect((await report(page)).parameters.aiModelId).toBe(modelId);
  expect((await report(page)).methods.en).toContain(modelId);
  await page.getByRole('checkbox', { name: /Use AI probability/ }).uncheck();
  expect((await report(page)).metrics).toBeNull();
  await requests(page, 4); await reply(page, 3);
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
  expect((await report(page)).parameters.aiUsed).toBe(false);
  expect((await report(page)).methods.en).not.toContain(modelId);
});
