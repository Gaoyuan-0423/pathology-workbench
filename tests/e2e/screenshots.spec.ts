/**
 * README 截图采集（仅本地运行；CI 跳过）。
 * 产出 docs/screenshots/app-analysis.png 与 app-coloc.png。
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from 'playwright/test';
import { createSyntheticColocPng, createSyntheticHdabPng } from './fixture.ts';

const OUT_DIR = 'docs/screenshots';

test('采集 README 截图', async ({ page }) => {
  test.skip(process.env.CI === 'true', 'screenshots are captured locally only');
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto('/');

  // 1. H-DAB 分析视图
  const hdab = createSyntheticHdabPng(560, 400);
  await page.setInputFiles('.dropzone input[type="file"]', {
    name: 'ki67-hdab.png',
    mimeType: 'image/png',
    buffer: hdab.buffer,
  });
  await expect(page.getByRole('status')).toContainText('已导入', { timeout: 15_000 });
  await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/app-analysis.png` });

  // 2. IF 共定位视图
  await page.getByRole('button', { name: 'IF 免疫荧光', exact: true }).click();
  const coloc = createSyntheticColocPng(560, 400);
  await page.setInputFiles('.dropzone input[type="file"]', {
    name: 'if-double.png',
    mimeType: 'image/png',
    buffer: coloc.buffer,
  });
  await expect(page.getByText('共定位结果')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  // 对共定位结果面板做元素级截图（数值特写，无需滚动页面）
  const colocPanel = page.locator('section.panel', { has: page.getByText('共定位结果') });
  await colocPanel.screenshot({ path: `${OUT_DIR}/app-coloc.png` });
});
