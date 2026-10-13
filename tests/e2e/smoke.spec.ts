import { expect, test } from 'playwright/test';
import { createSyntheticHdabPng } from './fixture.ts';

test('合成 IHC 图像全流程：导入 → 自动分析 → 指标可见 → 导出 Excel', async ({ page }) => {
  const fixture = createSyntheticHdabPng();
  await page.goto('/');

  await page.setInputFiles('input[type="file"]', {
    name: 'synthetic-hdab.png',
    mimeType: 'image/png',
    buffer: fixture.buffer,
  });

  // 结果表出现且整图阳性面积在合理区间（合成图约 10–30%）
  await expect(page.getByRole('status')).toContainText('已导入', { timeout: 15_000 });
  await expect(page.getByText('定量结果')).toBeVisible({ timeout: 15_000 });
  const overallCell = page.locator('.result-overall td').nth(1);
  await expect(overallCell).toHaveText(/%$/, { timeout: 15_000 });
  const fractionText = await overallCell.textContent();
  const fraction = Number.parseFloat(fractionText ?? '');
  expect(fraction).toBeGreaterThan(2);
  expect(fraction).toBeLessThan(40);

  // 标注指数行存在且非空（核分割生效）
  await expect(page.getByText('标注指数')).toBeVisible();

  // 导出 Excel 触发下载
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/pathology-workbench-.*\.xlsx$/);
});
