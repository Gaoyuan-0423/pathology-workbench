# IF 实验单位与统计

IF 结果库的一条记录是一次图像测量，可以含整图及多个 ROI。独立样本量由真实实验设计决定，不能由保存次数、ROI 数或像素数推断。此功能对 RGB 工作图的规范 IF 结果提供明确的层级汇总；原始通道和高位深限制见 [IF 区域分析](if-regions.md)。

## 操作和估计目标

1. 保存 IF 结果，在“IF 实验单位与统计”中选择四个系数之一：全像素 Pearson、掩膜 Pearson、Manders M1 或 M2。
2. 选择一种区域规则：每视野使用整图系数，或显式选择该图内互不重叠的 ROI，将这些 ROI 的系数作算术等权均值。后一规则下大小 ROI 等权，不按像素数或面积加权。不要把整图与 ROI 系数一起平均。
3. 为每条纳入记录填写来源、独立单位、切片、视野和组别，指定对照组。动物、患者或独立培养等何者是独立单位由实验者判断；不从文件名推断。
4. 在查看比较结果前确定指标与采样/选区方案，并核对独立性和采集可比性。确认只记录实验者的声明。
5. 查看逐组记录数、来源图像数、选区数、视野数、有效单位数及单位值；导出 IF 单位 CSV 或含设计、视野/区域、切片、单位、统计及 Methods 的 Excel。

顺序固定为：所选区域系数 → 每视野一个值 → 同来源同视野去重 → 切片内视野等权均值 → 单位内切片等权均值 → 每单位向其组贡献一个值。

例如一个视野选了面积分别为 100 和 200 像素的两个 ROI，系数为 0.2 和 0.8，视野值是 0.5。一个单位的两张切片分别有视野值 `[0.1, 0.2, 0.3]` 和 `[0.9]`，单位值为 `(0.2 + 0.9)/2 = 0.55`。这些值均是系数的层级算术平均，不是将所有像素合并后计算的 Pearson 或 Manders，也没有进行 Fisher z 转换。是否适合具体生物学问题需预先判断。

## 去重、缺失与冲突

- 相同来源、同单位/切片/视野、实际选区几何、所选系数及配置一致的重复记录只计一次。改显示名或 ROI ID 不增加 nBio。重复记录若均值相同但选区或区域值不同，仍阻止推断。
- 同一来源映射至不同单位/切片/视野、同一视野使用不同来源、同单位跨独立组、重复/缺失映射或缺失 ROI 均阻止推断。
- ROI 重叠根据实际裁切后的整数半开像素区判断；边界相接不算重叠。测量结果可保留重叠 ROI，但本次统计不能同时选入。
- 所选区域有任一指标为 null，该视野及所属单位的所选指标留空。不得将 null 改为零或仅平均其余视野/切片。真实零值保留。
- 纳入记录须使用相同 A/B 通道、背景百分位和阈值模式；手动模式比较实际有效阈值。自动模式各图的实际背景和阈值允许不同。同一来源的重复记录仍要求实际预处理一致。
- 来源哈希只识别字节相同的文件。重新编码、裁切或同一标本再次拍摄需要实验者保留正确关系。未知来源可填写明确声明，但不会因此变成经核验的原图哈希。

变更指标、区域规则、所选 ROI、映射、分组、纳入状态，或者新增/删除记录，会撤销确认。排除不删除原始结果。当前画布参数变化不会改写已保存记录；需另存新的测量后纳入设计。

## 推断范围与归档

仅确认且无冲突的独立组设计可进入单位汇总。各组至少两个有效单位且有明确对照组时复用现有统计引擎：两组 Welch t 和 Mann–Whitney，多组 ANOVA/Dunnett 与 Kruskal–Wallis/Holm。检出多组异方差时不输出普通 ANOVA/Dunnett；Welch ANOVA、配对及重复测量模型尚未实现。最低 n 只是软件门槛，不证明功效、近似分布或生物学解释适用；小样本、边界值和有界系数需按预声明方案解释，不按显著性择优报告。

`ifExperimentalDesign` 保存所选指标、区域规则及层级映射，`ifSamples` 保留原始结果和排除状态。UI、API、Excel、CSV 和 Methods 统一调用 `ifSampleStatistics`。旧项目缺少此设计时继续作为未确认描述；归档里的结构合法但冲突设计保留，重新计算统计后仍为 invalid，不能因导入而取得推断资格。

## English scope

IF statistics use dedicated canonical IF records and explicitly declared experimental units. Each field uses either its whole-image coefficient or the arithmetic, equally weighted mean of selected nonoverlapping ROI coefficients. Duplicate source fields are collapsed, fields are averaged within sections, and sections are averaged equally within units. The estimand is a hierarchical arithmetic mean of coefficients, not a pooled-pixel coefficient or Fisher-transformed correlation.

Missing selected measurements propagate through the field and unit without redistributing weights. Inference uses one value per usable declared independent unit, with a present control and at least two valid units in every group. Identity conflicts and incompatible configurations block inference. Confirmation does not establish biological independence, imaging comparability, sufficient power or scientific validity. Paired/repeated designs and raw multichannel/high-bit-depth IF are outside this implementation.
