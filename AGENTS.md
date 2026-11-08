# AGENTS.md — pathology-workbench（IHC／染色／IF）

面向 AI agent 在本仓库工作的约定。验证基准与无头调用样例：`~/Downloads/IHC测试图/`（`README_M3.md`、`run_m3.mjs`、`compare_reference.py`）。

## 结构

- `src/core/` — **纯函数引擎**（node 可测，无 DOM）：`analysis/engine.ts`（`analyzeStainImage` 染色三预设 / `analyzeColocImage` IF 共定位）、`analysis/metrics.ts`（`hScoreFromNuclei`）、`analysis/calibrate.ts`（对照片标定）、`analysis/threshold.ts`、`image/color.ts`（Ruifrok **矩阵求逆**去卷积）、`api.ts`（一键报告）。
- `src/core/image/decode.ts` — 解码需浏览器（createImageBitmap）；无头调用走 vite dev + Playwright 动态 import（样例 `run_m3.mjs`，Playwright 启动加 `--no-proxy-server`）。
- `src/core/analysis.worker.ts` + `src/ui/` — Worker 与界面；`ort/` 为可选 ONNX 核分割。

## 测量约定（不要偏离）

- 阈值**整图算一次套全部 ROI**；逐 ROI 独立 Otsu 是已知错误口径（假差可达 33pp）。
- 去卷积是 **Ruifrok 求逆法**（`buildStainMatrix`：单位化向量按列组矩阵 + 叉积残差行 + 逆矩阵第二行），不要改用归一化内积——会把苏木精串扰计入 DAB（阈值系统性偏高）。
- 膜/质标记读 **H-score**（`hScoreFromNuclei`，阳性 OD 区间三等分 1/2/3 分），labeling index 只对核标记有意义。
- 对照片标定（`controlThresholdFromChannel`，默认假阳率 0.001）优先于逐图 Otsu；弥漫背景图必须用它或核级指标。
- 泳道/ROI 提议是半自动设计；4060 类弱染色图仅解析出强泳道属预期，如实报告解析数。
- 解码只收 8/16 位无符号 TIFF/PNG，其余显式拒绝，不要加自动转换。
- IF 规范结果使用 `AnalysisResult.ifAnalysis`，历史兼容 `coloc`/`overall` 不用于构造新样本或冒充新区域结果。IF 全图预处理固定套 ROI；矩形逐参数 `Math.round` 后取真实半开交集，空交集不能强制为 1 像素。Pearson 无定义和 Manders 零分母用 `null` 与原因码，不能显示为零。旧 `coloc` 仅保留历史兼容约定。
- IF 保存到独立的 `ifSamples`，每条记录含整图及所有 ROI、自有配置和来源。IF 统计统一走 `ifSampleStatistics` 和独立的 `ifExperimentalDesign`，不可把 IF 伪装成染色记录。整图系数或显式选定不重叠 ROI 的系数算术均值先形成一个视野值，再去重视野、切片内视野等权、单位内切片等权；null 不重权，不做像素池化或 Fisher 变换。ROI/记录数不等于 nBio。详见 `docs/if-experimental-units.md`。

## 公开基准与 grader

四场景 35 图基准（H-DAB 12／IF 17／H&E 4／三色 2）：`run_m3.mjs` 全量跑，`results_m3/` 存指标与叠加图。面积对照 grader `compare_reference.py`（同阈值差 ≤0.6pp 优、≤2.2pp 通过）。**改图像或测量代码后必须重跑**；厂商图仅本机（来源 URL 在 `sources.json`），不进仓库与 deposit。

## 其他纪律

- 染色样本库统计统一调用 `sampleStatistics` / `aggregateExperimentalUnits`；IF 调用 `ifSampleStatistics`。共享的 `aggregateDeclaredUnits` 只接收真实视野值与声明身份；不得把图像条目直接当独立 n。仅显式确认的独立设计进入推断。染色路径的未知/混合预设、IF 占位指标和 ROI 记录仍不得绕过范围保护。详情见 `docs/experimental-units.md`。
- 原始记录、排除状态和实验单位映射分别保存；修改映射或纳入记录应撤销设计确认。导出/API/Methods 必须用同一当前指标和统计契约，不能信任外部传入的旧统计报告。
- 新增界面文案/导出字段**中英同步**（`src/i18n/`），Methods 文本（`methods.ts` zh/en 两段）与实际参数逐项一致。
- LICENSE 已定 MIT，README 与之保持一致。
- 发布走 blot-workbench 仓库的统一发布器（`release.py`），需所有者确认；本仓库 main 推送只触发 CI。
- `npm test`（含算法手算对照）与 `npx tsc -b` 必须全绿；E2E 走 CI。
