import { expect, test, type Page } from 'playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createEmptyProject, type PathologyExperimentalDesign, type ProjectState, type RoiMetrics, type SampleRecord } from '../../src/core/types.ts';
import { createSyntheticHdabPng } from './fixture.ts';

// These are declared, synthetic measurement records, not claims about raw-image
// provenance or real biological independence. Raw-byte identity has separate tests.
const metrics: RoiMetrics = {
  roiId: null, roiName: 'Whole image', pixelCount: 100, positiveFraction: 0.1,
  positiveNuclei: 10, totalNuclei: 100, labelingIndex: 0.1, borderNuclei: 0,
  integratedOpticalDensity: 100, meanOpticalDensity: 1, estimatedTotalCount: 100,
  densityPerMm2: 100, hScore: 10,
};
type Row = [id: string, group: string, unit: string, section: string, field: string, value: number];
function fixture(rows: Row[], confirmed = false): ProjectState {
  const samples: SampleRecord[] = rows.map(([id, group, , , , value]) => ({
    id, group, name: id, imageName: `${id}.tif`, sourceId: `manual:${id}`, profileId: 'h_dab', addedAt: 0,
    metrics: { ...metrics, positiveFraction: value, hScore: value * 100, densityPerMm2: value * 1000 },
  }));
  const experimentalDesign: PathologyExperimentalDesign = {
    kind: 'independent', confirmed, controlGroup: 'Control', aggregation: 'equal_sections',
    assignments: rows.map(([sampleId, group, unitId, sectionId, fieldId]) => ({ sampleId, group, unitId, sectionId, fieldId, sourceId: `manual:${sampleId}` })),
  };
  return { ...createEmptyProject(), samples, experimentalDesign };
}
function denseFixture(): ProjectState {
  const rows: Row[] = [];
  for (const group of ['Control', 'Treatment']) for (let unit = 1; unit <= 3; unit += 1) for (let field = 1; field <= 5; field += 1) {
    const unitId = `${group === 'Control' ? 'C' : 'T'}${unit}`;
    rows.push([`${unitId}-f${field}`, group, unitId, 's1', `f${field}`, (group === 'Control' ? 0.1 : 0.5) + unit * 0.01 + field * 0.001]);
  }
  return fixture(rows);
}
function hierarchyFixture(): ProjectState {
  return fixture([
    ['c1a', 'Control', 'C1', 's1', 'f1', 0.1], ['c1b', 'Control', 'C1', 's1', 'f2', 0.3],
    ['c1c', 'Control', 'C1', 's2', 'f1', 0.8], ['c2a', 'Control', 'C2', 's1', 'f1', 0.7],
    ['t1a', 'Treatment', 'T1', 's1', 'f1', 0.2], ['t2a', 'Treatment', 'T2', 's1', 'f1', 0.4],
  ]);
}
const report = (page: Page) => page.evaluate(() => (window as any).__pathologyAPI.getReportJson());
const confirmation = (page: Page) => page.getByRole('checkbox', { name: /^我已核对独立单位/ });
const metricSelect = (page: Page) => page.getByRole('combobox').filter({ has: page.locator('option[value="hScore"]') });
async function seed(page: Page, project: ProjectState) {
  await page.route('**/platform/wisplab.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    (window as any).WispLab = { registerProjectAdapter(adapter: unknown) { (window as any).__projectAdapter = adapter; } };
  });
  await page.goto('/?lang=zh');
  await page.waitForFunction(() => Boolean((window as any).__pathologyAPI));
  await page.evaluate(async (saved) => {
    const { set } = await import('/node_modules/idb-keyval/dist/index.js');
    await set('pathology-workbench:project:v1', saved);
  }, project);
  await page.reload();
  await expect.poll(async () => (await report(page)).samples.length).toBe(project.samples.length);
}

test('three units with five fields each report nBio=3, nImages=15 per group, export and restore the confirmed design and selected metric', async ({ page }) => {
  await seed(page, denseFixture());
  expect((await report(page)).statistics).toBeNull();
  expect((await report(page)).sampleStatistics.counts.nBio).toBeNull();
  await expect(page.locator('.chart-preview')).toHaveCount(0);
  await confirmation(page).check();
  await expect.poll(async () => (await report(page)).sampleStatistics.inference).toBe(true);
  const confirmed = await report(page);
  expect(confirmed.statistics.ns).toEqual([3, 3]);
  expect(confirmed.sampleStatistics.groupCounts).toEqual([
    expect.objectContaining({ group: 'Control', nRecords: 15, nImages: 15, nFields: 15, nBio: 3 }),
    expect.objectContaining({ group: 'Treatment', nRecords: 15, nImages: 15, nFields: 15, nBio: 3 }),
  ]);
  await expect(page.locator('.chart-preview')).toContainText('nBio=3');
  await expect(page.locator('.chart-preview')).not.toContainText('nBio=15');
  await metricSelect(page).selectOption('hScore');
  expect((await report(page)).sampleStatistics.aggregation.metric).toBe('hScore');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const book = XLSX.read(await readFile((await (await downloading).path())!), { type: 'buffer' });
  expect(book.SheetNames).toContain('实验单位');
  expect(book.SheetNames).toContain('切片汇总');
  expect(XLSX.utils.sheet_to_json(book.Sheets['实验单位'], { header: 1 })).toHaveLength(7);
  expect(book.SheetNames).toContain('统计检验');
  const exportedGroups = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['分组描述'], { header: 1 });
  expect(exportedGroups.find((row) => row[0] === 'Control')?.slice(0, 6)).toEqual(['Control', 'biological_unit', 3, 15, 15, 15]);
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '图表 SVG', exact: true }).click();
  const svg = await readFile((await (await svgDownload).path())!, 'utf8');
  expect(svg).toContain('Control (nBio=3)');
  expect(svg).toContain('Treatment (nBio=3)');
  expect(svg).not.toContain('nBio=15');
  if (process.env.WISPLAB_EVIDENCE_DIR) {
    await mkdir(process.env.WISPLAB_EVIDENCE_DIR, { recursive: true });
    const previousViewport = page.viewportSize();
    await page.setViewportSize({ width: 1920, height: 1400 });
    await page.getByRole('button', { name: 'IHC 免疫组化', exact: true }).click();
    await expect(page.getByRole('button', { name: 'IHC 免疫组化', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      const note = document.createElement('div');
      note.dataset.evidenceNote = 'synthetic';
      note.textContent = '固定合成测试 fixture · 每组 3 个声明单位 × 5 个视野 · 非真实实验数据';
      note.style.cssText = 'position:fixed;left:32px;bottom:24px;padding:14px 20px;background:#fff;border:1px solid #64748b;border-radius:8px;font-size:17px;z-index:9999;color:#0f172a;';
      document.body.append(note);
    });
    const designPanel = page.getByRole('region', { name: '实验单位与视野关系', exact: true });
    // Collapse repetitive cards for a readable evidence capture; retain the first
    // mapping and all saved data. This changes disclosure presentation only.
    await designPanel.locator('details').evaluateAll((cards) => cards.forEach((card, index) => { (card as HTMLDetailsElement).open = index === 0; }));
    // Scroll the nested pane explicitly. locator.screenshot() would otherwise
    // scroll its tall target underneath the fixed surrounding scene controls.
    await designPanel.evaluate((element) => {
      const pane = element.closest('.side-panel')!;
      pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
    });
    await page.screenshot({ path: join(process.env.WISPLAB_EVIDENCE_DIR, 'pathology-experimental-design-review.png'), fullPage: true });
    const summaryPanel = page.getByRole('region', { name: '实验单位汇总', exact: true });
    await summaryPanel.evaluate((element) => {
      const pane = element.closest('.side-panel')!;
      pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
      element.querySelectorAll('.unit-table-wrap').forEach((table) => { table.scrollLeft = table.scrollWidth; });
    });
    expect(await summaryPanel.evaluate((element) => {
      const cell = [...element.querySelectorAll('th')].find((heading) => heading.textContent === 'nBio')!;
      const bounds = cell.getBoundingClientRect();
      const table = cell.closest('.unit-table-wrap')!.getBoundingClientRect();
      return bounds.left >= table.left && bounds.right <= table.right && bounds.top > 0 && bounds.bottom < innerHeight;
    })).toBe(true);
    await page.screenshot({ path: join(process.env.WISPLAB_EVIDENCE_DIR, 'pathology-unit-summary-review.png'), fullPage: true });
    await page.evaluate(() => document.querySelector('[data-evidence-note="synthetic"]')?.remove());
    if (previousViewport) await page.setViewportSize(previousViewport);
  }

  await page.evaluate(async () => { (window as any).__savedUnitPackage = (await (window as any).__projectAdapter.exportProject()).blob; });
  await page.getByLabel('独立单位 ID C1-f1', { exact: true }).fill('changed-unit');
  const edited = await report(page);
  expect(edited.statistics).toBeNull();
  expect(edited.sampleStatistics.aggregation.designStatus).toBe('unconfirmed');
  expect(edited.sampleStatistics.report.omnibusParametric).toBeNull();
  await expect(page.locator('.chart-preview')).toHaveCount(0);
  await metricSelect(page).selectOption('positiveFraction');
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluate(async () => { await (window as any).__projectAdapter.importProject((window as any).__savedUnitPackage); });
  await expect(confirmation(page)).toBeChecked();
  await expect(page.getByLabel('独立单位 ID C1-f1', { exact: true })).toHaveValue('C1');
  await expect(metricSelect(page)).toHaveValue('hScore');
  const restored = await report(page);
  expect(restored.sampleStatistics.aggregation.metric).toBe('hScore');
  expect(restored.statistics.ns).toEqual([3, 3]);
  expect(restored.experimentalDesign.assignments).toEqual(confirmed.experimentalDesign.assignments);
});

test('section-equal aggregation collapses an exact repeated field, then rejects remapped duplicates and a unit spanning groups', async ({ page }) => {
  const project = hierarchyFixture();
  project.samples.push({ ...project.samples[2], id: 'duplicate', name: 'duplicate' });
  project.experimentalDesign!.assignments.push({ ...project.experimentalDesign!.assignments[2], sampleId: 'duplicate' });
  await seed(page, project); await confirmation(page).check();
  const current = await report(page);
  expect(current.sampleStatistics.counts).toMatchObject({ nRecords: 7, nImages: 6, nFields: 6, nBio: 4 });
  expect(current.sampleStatistics.aggregation.units.find((unit: any) => unit.unitId === 'C1').value).toBeCloseTo(0.5);
  expect(current.statistics.means[0]).toBeCloseTo(0.6); // neither flat-record 0.54 nor flat-field 0.475
  expect(current.statistics.ns).toEqual([2, 2]);
  expect(current.sampleStatistics.aggregation.issues.map((issue: any) => issue.code)).toContain('DUPLICATE_FIELDS_COLLAPSED');
  await page.getByLabel('独立单位 ID duplicate', { exact: true }).fill('C2');
  expect((await report(page)).statistics).toBeNull();
  await confirmation(page).check();
  expect((await report(page)).sampleStatistics.aggregation.designStatus).toBe('invalid');
  expect((await report(page)).sampleStatistics.aggregation.issues.map((issue: any) => issue.code)).toContain('SOURCE_FIELD_CONFLICT');
  await expect(page.locator('.chart-preview')).toHaveCount(0);
  await page.getByLabel('独立单位 ID duplicate', { exact: true }).fill('C1');
  await confirmation(page).check();
  expect((await report(page)).statistics.ns).toEqual([2, 2]);
  await page.getByLabel('独立单位 ID t1a', { exact: true }).fill('C1');
  await confirmation(page).check();
  const conflict = await report(page);
  expect(conflict.statistics).toBeNull();
  expect(conflict.sampleStatistics.aggregation.issues.map((issue: any) => issue.code)).toContain('UNIT_GROUP_CONFLICT');
});

for (const profile of ['h_eosin', undefined] as const) test(`${profile ?? 'unknown'} profile cannot enter inference; exclusion persists and a missing field reduces metric-specific nBio`, async ({ page }) => {
  const project = hierarchyFixture();
  project.samples[0].metrics.densityPerMm2 = null;
  project.samples.push({ ...project.samples[0], id: 'other-profile', name: 'other-profile', sourceId: 'manual:other', profileId: profile });
  project.experimentalDesign!.assignments.push({ sampleId: 'other-profile', sourceId: 'manual:other', unitId: 'C3', sectionId: 's1', fieldId: 'f1', group: 'Control' });
  await seed(page, project); await confirmation(page).check();
  expect((await report(page)).statistics).toBeNull();
  expect((await report(page)).sampleStatistics.aggregation.issues.map((issue: any) => issue.code)).toContain(profile ? 'PROFILE_MIXED' : 'PROFILE_UNKNOWN');
  const other = page.locator('.unit-assignment').filter({ has: page.locator('summary', { hasText: /^other-profile$/ }) });
  await other.getByRole('checkbox', { name: '纳入当前比较', exact: true }).uncheck();
  expect((await report(page)).sampleStatistics.aggregation.designStatus).toBe('unconfirmed');
  await confirmation(page).check();
  expect((await report(page)).sampleStatistics.inference).toBe(true);
  expect((await report(page)).sampleStatistics.counts).toMatchObject({ nRecords: 7, nIncludedRecords: 6, nExcludedRecords: 1, nBio: 4 });
  await metricSelect(page).selectOption('densityPerMm2');
  const missing = await report(page);
  expect(missing.statistics).toBeNull();
  expect(missing.sampleStatistics.report.inferenceStatus).toBe('blocked');
  expect(missing.sampleStatistics.groupCounts[0]).toMatchObject({ group: 'Control', nBio: 1, nUnitsMapped: 2, nImages: 4 });
  expect(missing.sampleStatistics.aggregation.units.find((unit: any) => unit.unitId === 'C1').value).toBeNull();
  expect(missing.sampleStatistics.aggregation.issues.map((issue: any) => issue.code)).toContain('FIELD_METRIC_MISSING');
  expect(missing.methods.en).toContain('Only descriptive statistics');
  await expect(page.locator('.chart-preview')).toContainText('Control (nBio=1)');
  // Only Treatment has a defined SD: one vertical stem and two caps. The
  // singleton Control unit must not receive a zero-length invented SD bar.
  await expect(page.locator('.chart-preview svg line[data-errorbar="sd"]')).toHaveCount(1);
  const stored = await page.evaluate(async () => {
    const { blob } = await (window as any).__projectAdapter.exportProject();
    const { importPathologyProject } = await import('/src/project-io.ts');
    const restored = await importPathologyProject(blob);
    return { samples: restored.project.samples, metric: restored.view.statsMetric };
  });
  expect(stored.samples.find((sample: any) => sample.id === 'other-profile').excludedFromStatistics).toBe(true);
  expect(stored.metric).toBe('densityPerMm2');
  await metricSelect(page).selectOption('positiveFraction');
  expect((await report(page)).statistics.ns).toEqual([2, 2]);
});

test('legacy records remain descriptive without invented unit or source identities', async ({ page }) => {
  const project = hierarchyFixture();
  delete project.experimentalDesign;
  project.samples.forEach((sample) => { delete sample.sourceId; delete sample.profileId; });
  await seed(page, project);
  const current = await report(page);
  expect(current.statistics).toBeNull();
  expect(current.sampleStatistics.counts).toMatchObject({ nRecords: 6, nImages: null, nBio: null });
  expect(current.sampleStatistics.aggregation.units).toEqual([]);
  await expect(confirmation(page)).toBeDisabled();
  await expect(page.getByLabel('来源 ID c1a', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('独立单位 ID c1a', { exact: true })).toHaveValue('');
  await expect(page.locator('.chart-preview')).toHaveCount(0);
  expect(current.methods.en).toContain('Only descriptive statistics');
});

/** Exercise real file decoding and source hashing while controlling only timing
 * and the analysis response. PNG hashes are held; model digests remain real.
 */
async function delayedSourceHash(page: Page) {
  await page.route('**/platform/wisplab.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript((baseMetrics) => {
    const host = window as any;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const pending: Array<() => Promise<unknown>> = [];
    host.__holdSourceHashes = false;
    host.__sourceHashStarts = 0;
    host.__releaseSourceHashes = async () => {
      host.__holdSourceHashes = false;
      await Promise.all(pending.splice(0).map((release) => release()));
    };
    crypto.subtle.digest = (algorithm: any, data: any) => {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!png || !host.__holdSourceHashes) return digest(algorithm, data);
      host.__sourceHashStarts += 1;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        pending.push(() => digest(algorithm, data).then(resolve, reject));
      });
    };
    host.Worker = class {
      onmessage: ((event: unknown) => void) | null = null;
      postMessage(request: any) {
        queueMicrotask(() => this.onmessage?.({ data: {
          requestId: request.requestId,
          overall: { ...baseMetrics, positiveFraction: request.ai.useAi ? 0.9 : 0.1 },
          perRoi: [], thresholdUsed: 40, nuclearThresholdUsed: 30, backgroundLevel: 0,
          overlay: null, coloc: null, qc: null, aiUsed: request.ai.useAi, aiRequested: request.ai.useAi,
          aiModelLoaded: request.ai.useAi ? request.ai.model?.name : null,
          aiModelId: request.ai.useAi ? request.ai.model?.id : null, warnings: [],
        } }));
      }
      terminate() {}
    };
  }, metrics);
}

test('changing AI while Add sample awaits source hashing discards the old result and does not report success', async ({ page }) => {
  await delayedSourceHash(page); await page.goto('/?lang=zh');
  await page.locator('input[type="file"][accept=".onnx"]').setInputFiles({ name: 'timing-only.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByRole('checkbox', { name: '用 AI 概率图替代苏木精 Otsu 分割', exact: true })).toBeChecked();
  await page.setInputFiles('.dropzone input[type="file"]', { name: 'pending-source.png', mimeType: 'image/png', buffer: createSyntheticHdabPng(100, 100).buffer });
  await expect.poll(async () => (await report(page)).analysisStatus).toBe('ready');
  expect((await report(page)).metrics.positiveFraction).toBe(0.9);
  await page.evaluate(() => { (window as any).__holdSourceHashes = true; });
  await page.getByRole('button', { name: '加入样本', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__sourceHashStarts)).toBe(1);
  await expect(page.getByRole('button', { name: '加入样本', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '用 AI 概率图替代苏木精 Otsu 分割', exact: true }).uncheck();
  await page.evaluate(async () => { await (window as any).__releaseSourceHashes(); });
  await expect(page.getByRole('button', { name: '加入样本', exact: true })).toBeEnabled();
  expect((await report(page)).samples).toHaveLength(0);
  await expect(page.getByRole('status')).not.toContainText('已加入样本库');
  expect((await report(page)).metrics.positiveFraction).toBe(0.1);
  await page.getByRole('button', { name: '加入样本', exact: true }).click();
  await expect.poll(async () => (await report(page)).samples.length).toBe(1);
  expect((await report(page)).samples[0].metrics.positiveFraction).toBe(0.1);
});

test('cancelling a batch during source hashing prevents the late hash from adding a sample', async ({ page }) => {
  await delayedSourceHash(page); await page.goto('/?lang=zh');
  await page.evaluate(() => { (window as any).__holdSourceHashes = true; });
  await page.setInputFiles('input[type="file"][aria-label="批处理图像"]', { name: 'cancel-source.png', mimeType: 'image/png', buffer: createSyntheticHdabPng(100, 100).buffer });
  await expect.poll(() => page.evaluate(() => (window as any).__sourceHashStarts)).toBe(1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(async () => { await (window as any).__releaseSourceHashes(); });
  await expect(page.getByRole('status')).toContainText('批处理已取消：完成 0/1');
  expect((await report(page)).samples).toHaveLength(0);
  await expect(page.locator('.batch-progress')).toContainText('已取消：完成 0/1');
  await expect(page.getByRole('button', { name: '选择多张图像', exact: true })).toBeEnabled();
});
