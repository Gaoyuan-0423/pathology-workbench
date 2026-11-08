import { test, expect, type Page } from 'playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { analyzeColocImage } from '../../src/core/analysis/engine.ts';
import { createEmptyProject, type IfSampleRecord, type ProjectState } from '../../src/core/types.ts';

// Fixed synthetic coefficient records test statistical plumbing and archive behavior.
// No source images or biological independence are claimed for these declarations.
function fixture(fields = 5, roiMode = false): ProjectState {
  const config = { channelA: 0 as const, channelB: 1 as const, thresholdMode: 'manual' as const, manualA: 0, manualB: 0, backgroundPercentile: 0 };
  const pixels = { width: 10, height: 2, data: Uint8ClampedArray.from(Array.from({ length: 20 }, (_, i) => [10 + i, 20 + i, 0, 255]).flat()) };
  const rois = [{ id: 'a', name: '左区域', x: 0, y: 0, w: 5, h: 2 }, { id: 'b', name: '右区域', x: 5, y: 0, w: 5, h: 2 }];
  const base = analyzeColocImage(pixels, config, rois).ifAnalysis;
  const samples: IfSampleRecord[] = [];
  const assignments: NonNullable<ProjectState['ifExperimentalDesign']>['assignments'] = [];
  for (const group of ['Control', 'Treatment']) for (let unit = 1; unit <= 3; unit++) for (let field = 1; field <= fields; field++) {
    const unitId = `${group === 'Control' ? 'C' : 'T'}${unit}`;
    const id = `${unitId}-f${field}`, value = (group === 'Control' ? 0.1 : 0.5) + unit * 0.04 + field * 0.002;
    const analysis = structuredClone(base);
    analysis.overall.pearsonAll = analysis.overall.pearsonMasked = value;
    analysis.perRoi.forEach((r, i) => { r.pearsonAll = r.pearsonMasked = value + (i === 0 ? -0.05 : 0.05); });
    samples.push({ id, group, name: id, imageName: `${id}.png`, sourceId: `declared:${id}`, profileId: 'if_coloc', addedAt: 0, config, analysis,
      image: { name: `${id}.png`, sourceType: 'PNG', sourceWidth: 10, sourceHeight: 2, workingWidth: 10, workingHeight: 2, workingScale: 1, bitsPerSample: 8 } });
    assignments.push({ sampleId: id, sourceId: `declared:${id}`, unitId, sectionId: 's1', fieldId: `f${field}`, group, roiIds: roiMode ? ['a', 'b'] : [] });
  }
  return { ...createEmptyProject(), profileId: 'if_coloc', ifSamples: samples, ifExperimentalDesign: {
    kind: 'independent', confirmed: false, controlGroup: 'Control', aggregation: 'equal_sections', metric: 'pearsonMasked',
    regionMode: roiMode ? 'equal_rois' : 'whole_image', assignments,
  } };
}
const report = (page: Page) => page.evaluate(() => (window as any).__pathologyAPI.getReportJson());
const confirmation = (page: Page) => page.getByRole('checkbox', { name: '我已核对 IF 独立单位、选区方案与采集可比性', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'IF 实验单位与统计', exact: true });
async function seed(page: Page, project: ProjectState, lang = 'zh') {
  await page.route('**/platform/wisplab.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => { (window as any).WispLab = { registerProjectAdapter(a: unknown) { (window as any).__projectAdapter = a; } }; });
  await page.goto(`/?lang=${lang}`);
  await page.waitForFunction(() => Boolean((window as any).__pathologyAPI));
  await page.evaluate(async (saved) => { const { set } = await import('/node_modules/idb-keyval/dist/index.js'); await set('pathology-workbench:project:v1', saved); }, project);
  await page.reload();
  await expect.poll(async () => (await report(page)).ifSamples.length).toBe(project.ifSamples!.length);
}
async function openAssignment(page: Page, id: string) {
  const card = panel(page).locator('details.unit-assignment').filter({ has: page.locator('summary', { hasText: new RegExp(`^${id} ·`) }) });
  if (!await card.evaluate((el) => (el as HTMLDetailsElement).open)) await card.locator('summary').click();
  return card;
}
async function capture(page: Page, filename: string, regionName: string) {
  if (!process.env.WISPLAB_EVIDENCE_DIR) return;
  await mkdir(process.env.WISPLAB_EVIDENCE_DIR, { recursive: true });
  await page.getByRole('region', { name: regionName, exact: true }).evaluate((el) => {
    const pane = el.closest('.side-panel');
    if (pane) pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
    el.querySelectorAll('.unit-table-wrap').forEach((table) => { table.scrollLeft = table.scrollWidth; });
  });
  await page.evaluate(() => {
    const note = document.createElement('div'); note.id = 'if-unit-evidence';
    note.textContent = 'SYNTHETIC COEFFICIENT RECORDS / 合成系数记录 · 非真实实验';
    note.style.cssText = 'position:fixed;bottom:4px;left:4px;right:4px;background:white;padding:6px;font:12px sans-serif;color:#334155;z-index:9999;border:1px solid #94a3b8;'; document.body.append(note);
  });
  await page.screenshot({ path: join(process.env.WISPLAB_EVIDENCE_DIR, filename), fullPage: true });
  await page.locator('#if-unit-evidence').evaluate((el) => el.remove());
}

test('IF 3 units x 5 fields uses 3 independent values, exports and restores the exact design', async ({ page }) => {
  await seed(page, fixture());
  expect((await report(page)).ifStatistics.counts.nBio).toBeNull();
  await expect(page.locator('.if-unit-tests')).toHaveCount(0);
  await confirmation(page).check();
  await expect.poll(async () => (await report(page)).ifInferenceStatus).toBe('available');
  const saved = await report(page);
  expect(saved.ifStatistics.report.ns).toEqual([3, 3]);
  expect(saved.ifStatistics.groupCounts).toEqual([
    expect.objectContaining({ group: 'Control', nRecords: 15, nImages: 15, nFields: 15, nRegions: 15, nBio: 3 }),
    expect.objectContaining({ group: 'Treatment', nRecords: 15, nImages: 15, nFields: 15, nRegions: 15, nBio: 3 }),
  ]);
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 IF 单位 CSV', exact: true }).click();
  const csv = await readFile((await (await csvEvent).path())!, 'utf8');
  expect(csv).toContain('掩膜 Pearson'); expect(csv).toContain('C1'); expect(csv).toContain('T3');
  const excelEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const book = XLSX.read(await readFile((await (await excelEvent).path())!), { type: 'buffer' });
  expect(book.SheetNames).toContain('IF 实验单位');
  expect(XLSX.utils.sheet_to_json(book.Sheets['IF 实验单位'], { header: 1 })).toHaveLength(7);
  await page.evaluate(async () => { (window as any).__savedIfUnitPackage = (await (window as any).__projectAdapter.exportProject()).blob; });
  await page.getByLabel('IF 比较指标', { exact: true }).selectOption('pearsonAll');
  expect((await report(page)).ifExperimentalDesign.confirmed).toBe(false);
  expect((await report(page)).ifInferenceStatus).toBe('descriptive_only');
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluate(async () => { await (window as any).__projectAdapter.importProject((window as any).__savedIfUnitPackage); });
  await expect(confirmation(page)).toBeChecked();
  const restored = await report(page);
  expect(restored.ifExperimentalDesign).toEqual(saved.ifExperimentalDesign);
  expect(restored.ifStatistics).toEqual(saved.ifStatistics);
  expect(restored.sampleStatistics.counts.nRecords).toBe(0);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const gaps = page.locator('.project-gaps');
  await expect(gaps.locator('summary')).toContainText('(60)');
  await gaps.locator('summary').click();
  await expect(gaps.locator('li')).toHaveCount(60);
  expect(await gaps.locator('ul').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(180);
  await gaps.locator('summary').click();
  await capture(page, 'synthetic-if-unit-summary.png', 'IF 单位汇总');
  const bounds = await page.getByRole('region', { name: 'IF 单位汇总', exact: true }).evaluate((el) => {
    const heading = [...el.querySelectorAll('th')].find((node) => node.textContent === 'nBio')!;
    const r = heading.getBoundingClientRect(); return { top: r.top, bottom: r.bottom };
  });
  expect(bounds.top).toBeGreaterThan(0); expect(bounds.bottom).toBeLessThan(1100);
});

test('IF selected ROIs and duplicate records do not increase nBio; changing selection and identity revokes confirmation', async ({ page }) => {
  const project = fixture(1, true);
  const copy = structuredClone(project.ifSamples![0]); copy.id = 'copy'; copy.name = 'copy';
  project.ifSamples!.push(copy);
  project.ifExperimentalDesign!.assignments.push({ ...project.ifExperimentalDesign!.assignments[0], sampleId: 'copy' });
  await seed(page, project);
  await confirmation(page).check();
  const stats = (await report(page)).ifStatistics;
  expect(stats.counts).toMatchObject({ nRecords: 7, nImages: 6, nRegions: 12, nFields: 6, nBio: 6 });
  expect(stats.aggregation.duplicateFieldGroups).toEqual([['C1-f1', 'copy']]);
  expect(stats.aggregation.units.find((u: any) => u.unitId === 'C1').value).toBeCloseTo(0.142);
  await openAssignment(page, 'C2-f1');
  await page.getByLabel('IF 选区 C2-f1 b', { exact: true }).uncheck();
  expect((await report(page)).ifExperimentalDesign.confirmed).toBe(false);
  await confirmation(page).check();
  expect((await report(page)).ifStatistics.counts.nRegions).toBe(11);
  await openAssignment(page, 'copy');
  await page.getByLabel('IF 独立单位 ID copy', { exact: true }).fill('fake-new-unit');
  expect((await report(page)).ifStatistics.inference).toBe(false);
  await expect(confirmation(page)).toBeDisabled();
  await page.getByText('查看尚未满足的设计条件', { exact: true }).click();
  await expect(panel(page)).toContainText('同一整图来源');
  await page.getByLabel('IF 纳入比较 copy', { exact: true }).uncheck();
  await confirmation(page).check();
  expect((await report(page)).ifStatistics.counts.nBio).toBe(6);
});

test('IF exclusion, group and newly saved measurements revoke an existing confirmation', async ({ page }) => {
  await seed(page, fixture(1));
  await confirmation(page).check();
  await openAssignment(page, 'C1-f1');
  await page.getByLabel('IF 纳入比较 C1-f1', { exact: true }).uncheck();
  expect((await report(page)).ifExperimentalDesign.confirmed).toBe(false);
  await confirmation(page).check();
  await page.getByLabel('IF 统计分组 C1-f1', { exact: true }).fill('Excluded');
  expect((await report(page)).ifExperimentalDesign.confirmed).toBe(false);
  await confirmation(page).check();
  const encoded = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 20; const x = c.getContext('2d')!; x.fillStyle = '#335500'; x.fillRect(0, 0, 20, 20); return c.toDataURL().split(',')[1]; });
  await page.setInputFiles('.dropzone input[type=file]', { name: 'synthetic-new-if.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
  await page.getByLabel('IF 分组标签', { exact: true }).fill('Control');
  await page.getByRole('button', { name: '保存 IF 结果', exact: true }).click();
  await expect.poll(async () => (await report(page)).ifSamples.length).toBe(7);
  expect((await report(page)).ifExperimentalDesign.confirmed).toBe(false);
  expect((await report(page)).ifInferenceStatus).toBe('descriptive_only');
});

test('English IF design and summaries fit a 390px screen and use translated issues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, fixture(1, true), 'en');
  const confirm = page.getByRole('checkbox', { name: 'I have reviewed IF independent units, region selection and acquisition comparability', exact: true });
  await confirm.check();
  await expect.poll(async () => (await report(page)).ifStatistics.inference).toBe(true);
  const p = page.getByRole('region', { name: 'IF experimental units and statistics', exact: true });
  await expect(p).toContainText('no Fisher z transformation');
  await expect(p).not.toContainText('实验单位');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, 'synthetic-if-unit-en-390.png', 'IF unit summaries');
});
