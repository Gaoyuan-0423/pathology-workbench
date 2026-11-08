# Validation scope — 2026-11-08

This update makes current-result validity and experimental-unit declarations explicit across the workbench. The completed work is software implementation and regression validation. Running a pipeline, reproducing a number, or confirming a design in the interface does not establish that the experiment or its scientific conclusion is valid.

## Implemented behavior

- **D03 — current analysis validity.** Image, ROI, analysis-setting and AI-model changes invalidate the current result. Late Worker responses cannot replace a newer run. AI models are identified by their bytes, failures are reported, and requested AI analysis is distinguished from an Otsu fallback. Display, saving, API output and export use the same validity gate. Imported historical results require recomputation before becoming current results.
- **D04 — IHC/H&E/Masson experimental units.** Saved whole-image measurements are linked explicitly to source, field, section, group and independent unit. Duplicate fields are counted once, fields are averaged within sections, and sections are averaged equally within each unit. Each unit contributes one value to a group. Unconfirmed designs, identity conflicts, unknown/mixed profiles and unsupported record types remain descriptive. Record/image counts are distinct from `nBio`; missing declared measurements do not become zero or redistribute weights. See [experimental units](experimental-units.md).
- **D07 — IF regional measurements and archives.** Canonical IF results contain whole-image and rectangular-ROI measurements, actual clipped bounds, masks/counts, backgrounds/thresholds, coefficient numerators/denominators and undefined-value reasons. Whole-image preprocessing is fixed across ROIs. Dedicated saved records retain their own sources and configurations; archive validation and record restoration preserve that association. Undefined coefficients remain `null`. Legacy stain-shaped placeholders are not used as new IF measurements. See [IF regions](if-regions.md).
- **D04-IF — IF experimental units.** A dedicated IF design chooses one coefficient and either whole-image measurements or an explicitly selected set of nonoverlapping ROIs. The latter produces an equally weighted arithmetic mean of ROI coefficients per field, followed by field deduplication, equal field weights within sections and equal section weights within units. There is no pixel pooling or Fisher transformation. Design/membership changes revoke confirmation. UI, API, CSV, Excel, diagnostics and bilingual Methods share `ifSampleStatistics`; raw regional exports remain separate from unit values. See [IF experimental units](if-experimental-units.md).

## Final software checks

The final local run completed on **2026-11-08 at 13:28 UTC**, using Chrome with one Playwright worker. Before preparing this PR, every one of the 65 changed-file entries in the captured implementation snapshot was compared with the working tree by SHA-256; all matched. This validation note is a documentation-only addition after that check. The local source snapshot and logs are retained outside this repository; their local paths are not public evidence links.

| Check | Recorded result |
| --- | --- |
| Unit tests | 28 files; 288/288 tests passed |
| TypeScript and Vite production build | Passed; bundle-size warning above 500 kB retained |
| Lint | Exit 0, with **9 React compiler/Hook warnings**; not warning-free |
| Full Chrome browser suite | 28/28 passed |
| Diff whitespace/conflict check | Passed |
| README screenshot protection | The two original screenshot files were restored byte-for-byte after the screenshot tests |

The repository contains the automated tests. Relevant cases include [current-result validity](../src/core/analysis-validity.test.ts), [stain experimental units](../src/core/experimental-units.test.ts), [IF regions](../src/core/analysis/if-regions.test.ts), [IF unit statistics](../src/core/if-statistics.test.ts), [IF reporting](../src/core/if-report.test.ts), [project round trips](../src/if-project-io.test.ts) and the corresponding [browser tests](../tests/e2e/). A fresh checkout can run:

```sh
npm ci
npm test
npm run build
npm run lint
npx playwright install chromium --with-deps
npx playwright test --workers=1
```

The screenshot test writes the README screenshots. Preserve those files before local reruns if the intention is to inspect test output without updating the documentation images. GitHub CI results are separate runs and must be assessed on the PR's commit.

## Numerical and image-regression evidence

The following are summaries of retained **local development checks**, not a public independent benchmark deposit. The external Python reference scripts and their full result artifacts are not included in this repository. Counts describe assertions and fixtures, not independent experiments or participants; targeted development checks are not added to the full-suite test denominator.

| Stage | Local evidence reviewed |
| --- | --- |
| D07 image regression | 35/35 historical development images completed: 12 H-DAB, 17 RGB IF, 4 H&E and 2 trichrome. All 1,226 compared legacy output fields matched. Vendor source images are not distributed in this PR. |
| D07 IF arithmetic | Independent Python calculations for 16 fixed scenarios: 1,224/1,224 checks and 17/17 hand-calculated anchors passed. Maximum Pearson/Manders absolute error was approximately `6.66e-16` at a prespecified `1e-12` tolerance. |
| D04-IF aggregation/statistics | Independent NumPy/SciPy calculations for 24 synthetic scenarios with 45 fixed record definitions: 2,767/2,767 checks and 13/13 arithmetic anchors passed. Hierarchical-value maximum absolute error was approximately `5.55e-17` at a `1e-12` tolerance. Statistical tolerances were method-specific; Dunnett used five fixed-seed numerical integrations with a `5e-4` tolerance. |
| Existing stain statistics after D04-IF | 4 fixed scenarios; 205/205 numerical regression checks passed. |

**The 35-image measurement suite was not rerun during D04-IF.** That stage changed aggregation, types, UI, reporting and archives. The final consistency audit verified that the eight image-measurement files and the package manifests were unchanged from the D07 measurement-validated version. Earlier D07 measurement results retain their original scope; they are not relabelled as a fresh D04-IF image experiment.

## Limits of the completed scope

- All existing inputs remain development/regression data: **`external_holdout = 0`**. No new real IF/IHC experiment, external blinded adjudication, user-benefit study or performance benchmark was conducted.
- Only declared **independent-group** designs are supported for inference. Paired and repeated-measures models and Welch ANOVA are not implemented. At least two usable units in every group is a software eligibility threshold, not evidence of adequate power or appropriate distributional assumptions.
- IF operates on decoded RGB working images and selected color channels. It does not add raw acquisition-channel, spectral, C/Z/T or high-bit-depth quantitative IF support. A 16-bit source still follows the existing fixed `v/257` mapping to an 8-bit working scale.
- Exact-file hashes identify identical bytes; they do not detect every crop, re-encoding or repeat acquisition and do not establish biological independence. Matching analysis configurations do not establish comparable acquisition conditions, unbiased ROI selection or scientific validity.
- Null propagation, deduplication and declared weights define the implemented estimand. Whether that estimand, threshold rule, selected coefficient or statistical test answers a particular biological question remains the experimenter's responsibility.

## 中文说明

本次完成的是当前结果失效保护、IHC/H&E/Masson 与 IF 的显式实验单位层级、IF 区域/配置归档及统一报告导出，并已完成上述软件回归。原始区域值与单位统计分开；ROI、像素、图像和保存次数不能代替独立生物学重复。全部现有数据仍属于开发回归，外部留出数据为 0。配对/重复测量、原始采集通道及高位深定量 IF 仍不支持；保留 9 条 lint 警告，D04-IF 阶段没有重新运行 35 图测量基准。代码和数值检查通过不能自动证明采样独立性、实验适用性或科学结论有效。
