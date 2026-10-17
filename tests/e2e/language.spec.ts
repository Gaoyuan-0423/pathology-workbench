import { expect, test, type Page } from 'playwright/test';
import { createSyntheticHdabPng } from './fixture.ts';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const fileName = '用户文件-病理.png';
async function expectEnglish(page: Page) {
  const visible = (await page.locator('body').innerText()).replaceAll('中文', '').replaceAll(fileName, '');
  expect(visible).not.toMatch(/[\u4e00-\u9fff]/);
  const attributes = await page.locator('[title], [aria-label], [placeholder]').evaluateAll(elements =>
    elements.flatMap(element => ['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name) ?? '')));
  expect(attributes.join(' ').replaceAll(fileName, '')).not.toMatch(/[\u4e00-\u9fff]/);
}

test('language URL priority, persistence, navigation and blocked storage', async ({ page }) => {
  await page.goto('/?lang=zh');
  await page.goto('/?lang=en&test=kept#anchor');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('wisplab.lang'))).toBe('en');
  await expectEnglish(page);
  for (const href of await page.locator('.suite-nav a').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))) {
    expect(new URL(href).searchParams.get('lang')).toBe('en');
  }
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(new URL(page.url()).searchParams.get('test')).toBe('kept');
  expect(new URL(page.url()).hash).toBe('#anchor');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  // Remove the URL language: persistence must work independently of the query.
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a workflow', exact: true })).toBeVisible();
  const blocked = await page.context().newPage();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage disabled'); } });
  });
  await blocked.goto('/?lang=en');
  await expect(blocked.getByRole('heading', { name: 'Choose a workflow', exact: true })).toBeVisible();
  await blocked.getByRole('button', { name: '中文', exact: true }).click();
  await expect(blocked.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await blocked.close();
});

test('switching language retains image, ROI, calibration, numbers and user input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as unknown as { analysisRequests: number }).analysisRequests = 0;
    Worker.prototype.postMessage = function (...args: Parameters<typeof post>) {
      if (args[0]?.requestId) (window as unknown as { analysisRequests: number }).analysisRequests += 1;
      return post.apply(this, args);
    };
  });
  await page.goto('/');
  await page.setInputFiles('.dropzone input[type="file"]', { name: fileName, mimeType: 'image/png', buffer: createSyntheticHdabPng().buffer });
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
  await page.getByPlaceholder('μm/px（可选）').fill('0.5');
  await page.getByRole('button', { name: '框选 ROI', exact: true }).click();
  const canvas = page.locator('canvas.canvas-main');
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x+b.width*.4,b.y+b.height*.4); await page.mouse.down();
  await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6); await page.mouse.up();
  await expect(page.getByRole('cell', { name: 'ROI 1', exact: true })).toBeVisible();
  await expect(page.getByLabel('背景百分位', { exact: true })).toBeEnabled();
  const before = await page.locator('.result-overall td').allTextContents();
  await page.getByPlaceholder('分组名').fill('自定义组');
  const requestsBefore = await page.evaluate(() => (window as unknown as { analysisRequests: number }).analysisRequests);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(550); // A language change must not schedule the 400 ms analysis debounce.
  expect(await page.evaluate(() => (window as unknown as { analysisRequests: number }).analysisRequests)).toBe(requestsBefore);
  expect((await page.locator('.result-overall td').allTextContents()).slice(1)).toEqual(before.slice(1));
  await expect(page.getByPlaceholder('μm/px (optional)')).toHaveValue('0.5');
  await expect(page.getByPlaceholder('Group name')).toHaveValue('自定义组');
  await expect(page.getByRole('cell', { name: 'ROI 1', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-caption')).toContainText(fileName);
  await expect(page.getByRole('status')).toHaveText('Imported');
  await expectEnglish(page);
  for (const scene of ['Routine & special stains', 'IF immunofluorescence', 'IHC immunohistochemistry']) {
    await page.getByRole('button', { name: scene, exact: true }).click();
    await expect(page.getByLabel('Background percentile', { exact: true })).toBeEnabled();
    await expectEnglish(page);
    while (await page.locator('details:not([open]) > summary').count()) await page.locator('details:not([open]) > summary').first().click();
    await expectEnglish(page);
  }
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(before[1]);
  const expand = page.getByRole('button', { name: /^Show all \d+ checks$/ });
  if (await expand.count()) await expand.click();
  // All disclosure sections are open from the scan above.
  await expectEnglish(page);
  await page.screenshot({ path: '/tmp/pathology-bilingual-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expectEnglish(page);
    await page.screenshot({ path: `/tmp/pathology-bilingual-${width}.png`, fullPage: true });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const downloaded = await download;
  const book = XLSX.read(await readFile((await downloaded.path())!), { type: 'buffer' });
  expect(book.SheetNames).toContain('Project information');
  expect(XLSX.utils.sheet_to_json(book.Sheets['Project information'], { header: 1 })).toContainEqual(['Stain preset', 'h_dab']);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8');
  expect(csv.replace(/^\uFEFF/, '').split('\n')[0]).toBe('Sample,Group,Image,Positive area,Positive nuclei,Total nuclei,Labeling index,H-score,IOD,Mean OD');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  expect((await page.locator('.result-overall td').allTextContents()).slice(1)).toEqual(before.slice(1));
  expect(errors).toEqual([]);
});

test('English errors and all scenes fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?lang=en');
  await page.setInputFiles('.dropzone input[type="file"]', { name:'bad.png', mimeType:'image/png', buffer:Buffer.from('not an image') });
  await expect(page.getByRole('status')).toHaveText('Unable to decode this image. Use PNG, JPEG or TIFF.');
  await expectEnglish(page);
  for (const scene of ['Routine & special stains', 'IF immunofluorescence', 'IHC immunohistochemistry']) {
    await page.getByRole('button', {name:scene, exact:true}).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});


test('English charts and diagnostic exports retain numerical data and user names', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.setInputFiles('.dropzone input[type="file"]', { name: fileName, mimeType: 'image/png', buffer: createSyntheticHdabPng().buffer });
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
  for (const group of ['Group A', 'Group B']) {
    await page.getByPlaceholder('Group name').fill(group);
    await page.getByRole('button', { name: 'Add sample', exact: true }).click();
    await page.getByRole('button', { name: 'Add sample', exact: true }).click();
  }
  await expect(page.locator('.chart-preview')).toContainText('Positive area by group');
  await expect(page.locator('.chart-preview')).toContainText('(mean ± SD)');
  await expectEnglish(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report JSON', exact: true }).click();
  const report = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(report.metrics['Positive area']).toEqual(expect.any(Number));
  expect(report.samples.map((sample: { group: string }) => sample.group)).toEqual(['Group A', 'Group A', 'Group B', 'Group B']);
  expect(report.image.name).toBe(fileName);
  expect(JSON.stringify(report.diagnostics)).not.toMatch(/[\u4e00-\u9fff]/);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.locator('.chart-preview')).toContainText('阳性面积 组间比较');
  await expect(page.locator('.chart-preview')).toContainText('（均值 ± SD）');
});
