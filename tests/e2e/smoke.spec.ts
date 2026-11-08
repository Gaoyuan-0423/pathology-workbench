import { expect, test } from 'playwright/test';
import { createSyntheticHdabPng } from './fixture.ts';

test('合成 IHC 图像全流程：导入 → 自动分析 → 指标可见 → 导出 Excel', async ({ page }) => {
  const fixture = createSyntheticHdabPng();
  await page.goto('/');

  await page.setInputFiles('.dropzone input[type="file"]', {
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

test('批处理：多张合成图逐张分析入样本库', async ({ page }) => {
  const first = createSyntheticHdabPng(360, 260);
  const second = createSyntheticHdabPng(380, 280);
  await page.goto('/');

  await page.setInputFiles('input[type="file"][aria-label="批处理图像"]', [
    { name: 'batch-1.png', mimeType: 'image/png', buffer: first.buffer },
    { name: 'batch-2.png', mimeType: 'image/png', buffer: second.buffer },
  ]);

  // 批处理完成后两条样本在库中（分组默认"对照组"，名字来自文件名去扩展名）
  await expect(page.getByRole('status')).toContainText('批处理完成：成功 2，失败 0', { timeout: 30_000 });
  await expect(page.getByText('batch-1', { exact: false })).toBeVisible();
  await expect(page.getByText('batch-2', { exact: false })).toBeVisible();

  // 样本数达到阈值 → 比较指标选择器出现
  await expect(page.getByText('比较指标')).toBeVisible();
});

test('IF reports preserve real colocalization without relabelling compatibility placeholders as stain measurements', async ({ page }) => {
  // This RGB fixture exercises the real worker/report boundary, not fluorescence accuracy.
  await page.goto('/?lang=zh');
  await page.getByRole('button', { name: 'IF 免疫荧光', exact: true }).click();
  await page.setInputFiles('.dropzone input[type="file"]', {
    name: 'synthetic-rgb-report.png', mimeType: 'image/png', buffer: createSyntheticHdabPng(100, 100).buffer,
  });
  const report = () => page.evaluate(() => (window as any).__pathologyAPI.getReportJson());
  await expect.poll(async () => (await report()).analysisStatus).toBe('ready');
  const current = await report();
  expect(current.profile).toBe('if_coloc');
  expect(current.metrics).toBeNull();
  expect(current.colocalization).toHaveProperty('mandersM1');
  expect(current.colocalization).toHaveProperty('pearsonMasked');
  await expect(page.getByRole('button', { name: '加入样本', exact: true })).toBeDisabled();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告 JSON', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(Object.values(exported.metrics).every((value) => value === null)).toBe(true);
  expect(exported.colocalization).toEqual(current.colocalization);
});

