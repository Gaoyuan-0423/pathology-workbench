import { expect, test, type Page } from 'playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

// Fixed, lossless RGB fixtures only. These browser checks do not establish
// biological validity, independence, microscope performance or raw TIFF precision.
const report = (page: Page) => page.evaluate(() => (window as any).__pathologyAPI.getReportJson());
const ready = (page: Page) => expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
const library = (page: Page) => page.locator('section').filter({ has: page.locator('.if-record-list') });
const currentResults = (page: Page) => page.locator('.analysis-results .if-results');
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/platform/wisplab.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    const host = window as any;
    host.WispLab = { registerProjectAdapter(adapter: unknown) { host.__projectAdapter = adapter; } };
    // Observe real Worker requests; computation and response delivery are untouched.
    host.__ifWorkerRequests = 0;
    const RealWorker = window.Worker;
    host.Worker = class extends RealWorker {
      postMessage(message: any, transfer: Transferable[]) {
        host.__ifWorkerRequests += 1;
        super.postMessage(message, transfer);
      }
    };
  });
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

async function uploadSynthetic(page: Page, lang: 'zh' | 'en' = 'zh', zero = false) {
  await page.goto(`/?lang=${lang}`);
  await page.getByRole('button', { name: lang === 'zh' ? 'IF 免疫荧光' : 'IF immunofluorescence', exact: true }).click();
  const data = await page.evaluate((allZero) => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(240, 160);
    for (let y = 0; y < 160; y += 1) for (let x = 0; x < 240; x += 1) {
      const i = (y * 240 + x) * 4;
      const r = allZero || y >= 120 ? 0 : 20 + (x % 40) * 5;
      image.data[i] = r;
      image.data[i + 1] = allZero || y >= 120 ? 0 : x < 120 ? r : 240 - r;
      image.data[i + 2] = 0;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, zero);
  const buffer = Buffer.from(data, 'base64');
  await page.setInputFiles('.dropzone input[type="file"]', { name: zero ? 'synthetic-if-zero.png' : 'synthetic-if-regions.png', mimeType: 'image/png', buffer });
  await ready(page);
  expect((await report(page)).ifAnalysis.schemaVersion).toBe('wisplab.if-colocalization/v1');
  return buffer;
}

async function drawRegion(page: Page, rect: { x: number; y: number; w: number; h: number }) {
  const draw = page.getByRole('button', { name: '框选 ROI', exact: true });
  if (await draw.count()) await draw.click();
  const canvas = page.locator('canvas.canvas-main');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 240, box.height / 160) * 0.96;
  const tx = (box.width - 240 * scale) / 2, ty = (box.height - 160 * scale) / 2;
  const x = box.x + tx + rect.x * scale, y = box.y + ty + rect.y * scale;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + rect.w * scale, y + rect.h * scale, { steps: 6 });
  await page.mouse.up();
}

async function assertUnavailable(page: Page) {
  // Read the current identity during the real 400 ms debounce window.
  const pending = await report(page);
  expect(pending.analysisStatus).toBe('pending');
  expect(pending.ifAnalysis).toBeNull();
  expect(pending.colocalization).toBeNull();
  expect(pending.colocalizationStatus).toBe('unavailable');
  expect(pending.metrics).toBeNull();
  await expect(page.getByRole('button', { name: '保存 IF 结果', exact: true })).toBeDisabled();
  // Historical records remain visible separately; the current result disappears.
  await expect(currentResults(page)).toHaveCount(0);
  await expect(library(page).locator('.if-results')).toHaveCount(pending.ifSamples.length);
}

async function screenshot(page: Page, name: string, focus: 'results' | 'roi' | 'library' = 'results') {
  if (!process.env.WISPLAB_EVIDENCE_DIR) return;
  await mkdir(process.env.WISPLAB_EVIDENCE_DIR, { recursive: true });
  const panel = focus === 'library' ? library(page) : focus === 'roi' ? currentResults(page).locator('.if-roi-results') : currentResults(page);
  await panel.evaluate((element) => {
    const pane = element.closest('.side-panel') ?? element.closest('.analysis-results');
    if (pane) pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
    else element.scrollIntoView({ block: 'start' });
  });
  await page.evaluate(() => {
    const note = document.createElement('div'); note.dataset.ifEvidence = 'synthetic';
    note.textContent = 'SYNTHETIC RGB FIXTURE · 软件验收 / software check · 非生物实验 / not biological data';
    note.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-width:700px;padding:8px;background:#fff;border:1px solid #334155;font:12px sans-serif;color:#0f172a;z-index:9999;box-sizing:border-box;';
    document.body.append(note);
  });
  await page.screenshot({ path: join(process.env.WISPLAB_EVIDENCE_DIR, name), fullPage: true });
  await page.locator('[data-if-evidence]').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test('real IF Worker preserves whole-image thresholds across drawn ROIs, exports, archives and restores the saved configuration', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const bytes = await uploadSynthetic(page);
  for (const rect of [{ x: 10, y: 10, w: 80, h: 70 }, { x: 140, y: 10, w: 80, h: 70 }, { x: 20, y: 130, w: 80, h: 20 }]) {
    await drawRegion(page, rect); await ready(page);
  }
  const before = await report(page);
  expect(before.ifInferenceStatus).toBe('descriptive_only');
  expect(before.samples).toEqual([]); expect(before.statistics).toBeNull();
  const regions = before.ifAnalysis.perRoi;
  expect(regions).toHaveLength(3);
  expect(regions[0].pearsonAll).toBeCloseTo(1, 12);
  expect(regions[1].pearsonAll).toBeCloseTo(-1, 12);
  expect(regions[0].rect).toEqual({ x: 10, y: 10, w: 80, h: 70 });
  expect(regions[1].rect).toEqual({ x: 140, y: 10, w: 80, h: 70 });
  for (const region of regions) for (const key of ['backgroundA', 'backgroundB', 'thresholdA', 'thresholdB']) expect(region[key]).toBe(before.ifAnalysis.overall[key]);
  expect(regions[2].pearsonAll).toBeNull(); expect(regions[2].mandersM1).toBeNull();
  expect(regions[2].undefinedReasons).toContain('manders_m1_zero_denominator');
  await expect(page.locator('.if-roi-results tbody tr')).toHaveCount(3);
  await page.getByRole('textbox', { name: 'IF 分组标签', exact: true }).fill('Synthetic group');
  await page.getByRole('button', { name: '保存 IF 结果', exact: true }).click();
  await expect.poll(async () => (await report(page)).ifSamples.length).toBe(1);
  const record = (await report(page)).ifSamples[0];
  expect(record.sourceId).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  expect(record.analysis).toEqual(before.ifAnalysis);
  expect(record.config).toEqual(before.parameters.coloc);
  expect(record.image.workingWidth).toBe(240); expect(record.image.workingHeight).toBe(160);

  const csvDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 IF CSV', exact: true }).click();
  const csv = await readFile((await (await csvDownloading).path())!, 'utf8');
  const csvBook = XLSX.read(Buffer.from(csv, 'utf8'), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(csvBook.Sheets[csvBook.SheetNames[0]], { defval: null });
  expect(rows).toHaveLength(8); // current and saved: whole image plus three ROIs
  const savedZero = rows.find((row) => row['记录类型'] === 'saved' && row['区域名称'] === regions[2].roiName)!;
  expect(savedZero['来源 ID']).toBe(record.sourceId);
  expect(savedZero['Manders M1']).toBeNull();
  expect(savedZero['未定义原因代码']).toContain('manders_m1_zero_denominator');
  const excelDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const book = XLSX.read(await readFile((await (await excelDownloading).path())!), { type: 'buffer' });
  expect(book.SheetNames).toContain('当前 IF'); expect(book.SheetNames).toContain('历史 IF');
  // CSV has no distinct empty-string cell type; compare both blank encodings as null.
  const excelRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['历史 IF'], { defval: null });
  expect(excelRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === '' ? null : value]))))
    .toEqual(rows.filter((row) => row['记录类型'] === 'saved'));
  await screenshot(page, 'synthetic-if-desktop-results.png');
  await screenshot(page, 'synthetic-if-desktop-roi-results.png', 'roi');

  const archive = await page.evaluate(async () => {
    const host = window as any;
    host.__savedIfPackage = (await host.__projectAdapter.exportProject()).blob;
    const { importPathologyProject } = await import('/src/project-io.ts');
    const { sourceContentId } = await import('/src/core/source-identity.ts');
    const imported = await importPathologyProject(host.__savedIfPackage);
    const saved = imported.project.ifSamples![0];
    const source = imported.project.sources!.samples[saved.id];
    return { record: saved, sourceHash: await sourceContentId(source.image!), settings: source.settings };
  });
  expect(archive.record).toEqual(record); expect(archive.sourceHash).toBe(record.sourceId);
  expect(archive.settings.rois).toEqual(before.parameters.rois);
  await page.getByLabel('通道 B', { exact: true }).selectOption('2'); await ready(page);
  expect((await report(page)).ifAnalysis.overall.mandersM2).toBeNull();
  const countBeforeImport = await page.evaluate(() => (window as any).__ifWorkerRequests);
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluate(async () => (window as any).__projectAdapter.importProject((window as any).__savedIfPackage));
  await ready(page);
  expect(await page.evaluate(() => (window as any).__ifWorkerRequests)).toBeGreaterThan(countBeforeImport);
  expect((await report(page)).ifAnalysis).toEqual(before.ifAnalysis);
  expect((await report(page)).ifSamples[0]).toEqual(record);

  await page.getByRole('button', { name: '手动', exact: true }).click(); await ready(page);
  await page.getByLabel('通道 A 阈值', { exact: true }).fill('250'); await ready(page);
  await page.getByLabel('通道 B', { exact: true }).selectOption('2'); await ready(page);
  await page.locator('.roi-list li').last().getByRole('button', { name: '删除', exact: true }).click(); await ready(page);
  await library(page).locator('.if-record > summary').click();
  const countBeforeRestore = await page.evaluate(() => (window as any).__ifWorkerRequests);
  await page.getByRole('button', { name: '载入此记录并复算', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__ifWorkerRequests)).toBeGreaterThan(countBeforeRestore);
  await ready(page);
  expect((await report(page)).parameters.coloc).toEqual(record.config);
  expect((await report(page)).parameters.rois).toEqual(archive.settings.rois);
  expect((await report(page)).ifAnalysis).toEqual(record.analysis);
  expect((await report(page)).ifSamples).toHaveLength(1);
  await screenshot(page, 'synthetic-if-restored-record.png', 'library');
});

test('channel, threshold and ROI edits immediately withhold stale IF display, API and save with a real Worker', async ({ page }) => {
  await uploadSynthetic(page);
  await page.getByRole('textbox', { name: 'IF 分组标签', exact: true }).fill('Synthetic group');
  await page.getByRole('button', { name: '保存 IF 结果', exact: true }).click();
  await expect.poll(async () => (await report(page)).ifSamples.length).toBe(1);
  const saved = (await report(page)).ifSamples[0];
  await page.getByLabel('通道 B', { exact: true }).selectOption('2'); await assertUnavailable(page); await ready(page);
  await page.getByRole('button', { name: '手动', exact: true }).click(); await assertUnavailable(page); await ready(page);
  await page.getByLabel('通道 A 阈值', { exact: true }).fill('250'); await assertUnavailable(page); await ready(page);
  await drawRegion(page, { x: 10, y: 10, w: 80, h: 70 }); await assertUnavailable(page); await ready(page);
  await page.locator('.roi-list li').getByRole('button', { name: '删除', exact: true }).click(); await assertUnavailable(page); await ready(page);
  expect((await report(page)).ifSamples).toEqual([saved]);
});

for (const lang of ['zh', 'en'] as const) test(`${lang} 390px zero-signal IF shows undefined reasons without page overflow`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await uploadSynthetic(page, lang, true);
  const result = (await report(page)).ifAnalysis.overall;
  expect(result.pearsonAll).toBeNull(); expect(result.pearsonMasked).toBeNull();
  expect(result.mandersM1).toBeNull(); expect(result.mandersM2).toBeNull();
  expect(result.undefinedReasons).toContain('pearson_all_zero_variance');
  await expect(currentResults(page).locator('.if-overall')).toContainText(lang === 'zh' ? '未定义' : 'Undefined');
  await expect(currentResults(page)).toContainText(lang === 'zh' ? '至少一个通道的方差为零' : 'at least one channel has zero variance');
  await expect(currentResults(page)).toContainText(lang === 'zh' ? '区域内 A 通道总强度为零' : 'channel A has zero total intensity');
  await expect(page.locator('body')).not.toContainText(lang === 'zh' ? '样本库为空' : 'The sample library is empty');
  await expect(page.locator('body')).not.toContainText(lang === 'zh' ? '核分割' : 'nuclear segmentation');
  const diagnostics = JSON.stringify((await report(page)).diagnostics);
  expect(diagnostics).not.toContain('样本库为空');
  expect(diagnostics).not.toContain('核分割');
  expect(diagnostics).toContain('IF 当前仅提供描述统计');
  expect(diagnostics).not.toContain('本模块不提供 IF 组间检验');
  expect((await report(page)).ifInferenceStatus).toBe('descriptive_only');
  await expect(library(page)).toContainText(lang === 'zh'
    ? '分组标签用于整理；组间推断还需确认下方的 IF 实验单位和汇总方案'
    : 'Group labels organize records; group inference also requires confirmation');
  await page.getByRole('textbox', { name: lang === 'zh' ? 'IF 分组标签' : 'IF group label', exact: true }).fill('Synthetic zero');
  await page.getByRole('button', { name: lang === 'zh' ? '保存 IF 结果' : 'Save IF results', exact: true }).click();
  await expect.poll(async () => (await report(page)).ifSamples.length).toBe(1);
  await library(page).locator('.if-record > summary').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const valueBounds = await currentResults(page).locator('.if-overall tr').first().locator('td').nth(1).boundingBox();
  expect(valueBounds!.x).toBeGreaterThanOrEqual(0);
  expect(valueBounds!.x + valueBounds!.width).toBeLessThanOrEqual(390);
  await screenshot(page, `synthetic-if-${lang}-390.png`);
});
