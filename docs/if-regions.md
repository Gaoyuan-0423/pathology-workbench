# IF 区域分析与归档

此功能对解码后的 RGB 工作图选择两个颜色通道进行共定位分析。它不恢复原始采集通道、光谱信息或 C/Z/T 轴，也不新增原始多通道、高位深 IF 通路。输入规格仍按现有解码器执行。

## 操作

1. 进入“IF 免疫荧光”，导入图像，选择通道 A/B、背景百分位与自动或手动阈值。
2. 在画布框选矩形 ROI。工作台重新计算整图及各区域结果；改变通道、背景、阈值或 ROI 后，旧结果立即失效。
3. 在结果表查看系数；展开区域信息可核对实际工作像素边界、阳性并集/交集与像素数。未定义的数值显示原因。
4. 在“IF 结果库”填写分组标签，保存本次整图及所有 ROI。每条记录保存自己的来源身份、图像元数据、配置、区域及结果。标签本身不触发组间推断；需要比较时，在下方[IF 实验单位与统计](if-experimental-units.md)明确指标、选区与层级，再确认设计。
5. 导出 IF CSV 或 Excel 的当前/历史 IF 表；项目包同时保存原图与历史设置。记录展开后可“载入此记录并复算”，从该记录的原图和设置重新计算，不直接把保存值恢复为当前有效结果。

缺少原图附件时仍可保存已有描述结果，来源明确为未知或保留已知历史身份；完整性报告列出缺失项，不能执行需要原图的记录复算。项目导入的分析值保留为历史，只有完成当前计算才成为有效结果。新版本可读取旧项目；旧格式缺少的 ROI、像素计数和分母不能自动补造。

## 数值口径

- 在整张工作图上分别计算 A/B 背景百分位，逐像素减去背景并将负值置零。自动阈值在整图背景扣除后的各通道上计算；手动阈值四舍五入并限制在 0–255。背景和阈值固定用于所有 ROI，不逐 ROI 重新调节。
- 矩形 x/y/w/h 各自 `Math.round` 后，与图像 `[0,width) × [0,height)` 求真实交集；结果保存实际整数半开范围。无交集时像素数为 0；非法尺寸、非有限坐标和空/重复 ROI ID 明确拒绝。
- 阳性定义为背景扣除后强度严格大于对应阈值。全区域 Pearson 使用区域全部像素；掩膜 Pearson 使用 A 阳性或 B 阳性的并集。
- M1 为区域内 B 阳性像素上的 A 强度和，除以该区域全部 A 强度和；M2 对称。分母不改成 A 自身阳性像素强度和，也不把两个 ROI 的系数混成整图系数。
- Pearson 少于两个参与像素或任一通道零方差时为 `null`；Manders 分母为零时为 `null`。原因码、分子/分母及掩膜计数随结果保存，CSV/Excel 留空而不是写 0。

背景百分位采用既有离散直方图约定：累计计数首次达到 `p/100 × N` 时返回该 bin；p=0 返回 bin 0，因此本版本的 0% 表示不扣背景。此规则与线性插值分位数不同。

## 结果与统计范围

`ifAnalysis` 是新增规范结构，包含 `schemaVersion`、整图归一化范围、工作尺寸、`overall` 和 `perRoi`。每个区域保留几何、通道、背景、阈值、计数、强度和、系数及未定义原因。`ifSamples` 是独立的历史结果集合，一条记录可以包含多个或重叠 ROI。

这些是区域级描述测量。像素数、ROI 数、图像数和重复保存次数都不是独立生物学样本量。IF 现可通过专用 `ifExperimentalDesign` 和 `ifSampleStatistics` 接入独立单位的分层汇总与组间推断；同一来源的多个 ROI 不自动增加 nBio。IHC/H&E/Masson 的既有单位统计仍使用原来的样本集合。

旧 `coloc` 和 `RoiMetrics` 仅为兼容原有接口保留，包括旧零信号 Manders 占位约定。新 UI/API/导出优先使用 `ifAnalysis` 的真实值和 `null` 语义；旧格式返回 `legacy_whole_image` 状态并明确未记录的范围，不能转换成新的 IF 样本。

## English scope

IF measurements use two selected channels of the decoded RGB working image. Whole-image backgrounds and thresholds are applied unchanged to every rectangle. Regional Pearson uses either all pixels or the positive-channel union; Manders denominators include all corresponding background-corrected intensity within the region. Undefined coefficients remain null with explicit reasons.

Saved IF records contain their own source, settings and whole-image/ROI measurements. Project import does not certify historical image results as current; recomputation is required. Dedicated IF study statistics now aggregate selected coefficients through explicitly declared fields, sections and independent units; see [IF experimental units](if-experimental-units.md). This does not add raw acquisition-channel, C/Z/T or high-bit-depth IF support.
