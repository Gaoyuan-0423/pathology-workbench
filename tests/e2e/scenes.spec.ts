import { expect, test, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { createSyntheticHdabPng } from './fixture.ts';

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), '场景操作不应产生浏览器异常或 React 错误').toEqual([]);
});

async function importImage(page: Page) {
  await page.setInputFiles('.dropzone input[type="file"]', {
    name: 'scene-switch.png',
    mimeType: 'image/png',
    buffer: createSyntheticHdabPng().buffer,
  });
  await expect(page.getByRole('status')).toContainText('已导入');
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
}

async function exportExcel(page: Page, profile: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/pathology-workbench-.*\.xlsx$/);
  expect(await download.failure()).toBeNull();
  const filePath = await download.path();
  if (!filePath) throw new Error('Excel 下载未保存');
  const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' });
  expect(XLSX.utils.sheet_to_json(workbook.Sheets['项目信息'], { header: 1 }))
    .toContainEqual(['染色预设', profile]);
}

test('切换场景保留图像和 ROI，并能分析与导出', async ({ page }) => {
  await page.goto('/');
  await importImage(page);
  const originalFraction = await page.locator('.result-overall td').nth(1).textContent();

  await page.getByRole('button', { name: '框选 ROI', exact: true }).click();
  const canvas = page.locator('canvas.canvas-main');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('图像画布不可见');
  const halfSide = Math.min(bounds.width, bounds.height) * 0.15;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX - halfSide, centerY - halfSide);
  await page.mouse.down();
  await page.mouse.move(centerX + halfSide, centerY + halfSide, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.roi-list')).toContainText('ROI 1');
  await expect(page.locator('.result-table').getByRole('cell', { name: 'ROI 1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '常规与特殊染色', exact: true }).click();
  await page.getByRole('button', { name: 'Masson 三色', exact: true }).click();
  await expect(page.getByRole('heading', { name: '苯胺蓝 阈值与背景', exact: true })).toBeVisible();
  await expect(page.getByLabel('背景百分位', { exact: true })).toBeEnabled();
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
  await expect(page.locator('.roi-list')).toContainText('ROI 1');
  await exportExcel(page, 'masson');

  await page.getByRole('button', { name: 'IF 免疫荧光', exact: true }).click();
  await expect(page.getByRole('heading', { name: '共定位结果', exact: true })).toBeVisible();
  const pearson = page.getByRole('row', { name: /掩膜 Pearson r/ }).getByRole('cell').nth(1);
  await expect(pearson).toHaveText(/^-?\d\.\d{3}$/);
  await expect(page.getByRole('region', { name: '染色定量参数', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-caption')).toContainText('scene-switch.png');
  await expect(page.locator('.roi-list')).toContainText('ROI 1');
  await exportExcel(page, 'if_coloc');

  await page.getByRole('button', { name: '常规与特殊染色', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Masson 三色', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.result-table').getByRole('cell', { name: 'ROI 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'IHC 免疫组化', exact: true }).click();
  await expect(page.getByLabel('背景百分位', { exact: true })).toBeEnabled();
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(originalFraction ?? '');
  await expect(page.locator('.workspace-caption')).toContainText('scene-switch.png');
  await expect(page.locator('.roi-list')).toContainText('ROI 1');
});

test('特殊染色参数仍驱动计算，现有 v1 项目重载恢复场景和参数', async ({ page }) => {
  await page.goto('/');
  await importImage(page);
  await page.getByRole('button', { name: '常规与特殊染色', exact: true }).click();
  await page.getByRole('button', { name: 'Masson 三色', exact: true }).click();
  await page.getByText('细胞核分割（可选）', { exact: true }).click();
  await page.getByLabel('最小面积 px', { exact: true }).fill('37');
  await page.getByRole('button', { name: '手动', exact: true }).click();
  await page.getByLabel('阈值（OD 0–255）', { exact: true }).fill('255');
  await expect(page.locator('.result-overall td').nth(1)).toHaveText('0.00%');

  // Wait for the existing debounced IndexedDB save, without assuming a fixed delay.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('keyval', 'readonly').objectStore('keyval').get('pathology-workbench:project:v1');
        request.onsuccess = () => resolve({
          version: request.result?.version,
          profileId: request.result?.profileId,
          manualValue: request.result?.threshold.manualValue,
          minAreaPx: request.result?.segmentation.minAreaPx,
        });
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  })).toEqual({ version: 1, profileId: 'masson', manualValue: 255, minAreaPx: 37 });

  await page.reload();
  await expect(page.getByRole('button', { name: '常规与特殊染色', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Masson 三色', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.workspace-caption')).toContainText('scene-switch.png');
  await expect(page.getByLabel('阈值（OD 0–255）', { exact: true })).toHaveValue('255');
  await expect(page.locator('.result-overall td').nth(1)).toHaveText('0.00%');
  await expect(page.getByLabel('最小面积 px', { exact: true })).not.toBeVisible();
  await page.getByText('细胞核分割（可选）', { exact: true }).click();
  await expect(page.getByLabel('最小面积 px', { exact: true })).toHaveValue('37');
  await page.getByLabel('阈值（OD 0–255）', { exact: true }).fill('0');
  await expect(page.locator('.result-overall td').nth(1)).not.toHaveText('0.00%');
});

test('390px 屏幕可切换所有场景，分析后页面不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importImage(page);

  for (const scene of ['IHC 免疫组化', '常规与特殊染色', 'IF 免疫荧光']) {
    const entry = page.getByRole('button', { name: scene, exact: true });
    await entry.click();
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    const bounds = await entry.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.workspace-caption')).toContainText('scene-switch.png');
  }
  await expect(page.getByRole('heading', { name: '共定位结果', exact: true })).toBeVisible();
});
