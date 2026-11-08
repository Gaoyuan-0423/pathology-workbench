# 实验单位与统计范围

样本库中的一条记录代表一次整图测量，不自动代表一个独立生物学样本。此页描述 IHC、H&E 和 Masson 的整图指标；IF 使用[专用实验单位与统计](if-experimental-units.md)。IF 的染色兼容占位值仍留空并标记不支持，真实共定位结果不混入染色指标的描述统计。

## 使用流程

1. 添加图像测量后，在“实验单位与视野关系”选择独立设计和明确对照组。
2. 为每条纳入记录填写单位、切片、视野与组别。动物、患者或独立培养等何者构成实验单位，由实验者依据真实设计确认；程序不从文件名猜测。
3. 新记录保存原文件字节 SHA-256 和实际分析预设。旧项目可从保留原图补全来源与历史预设；缺少原图时可显式填写来源声明，程序不能独立验证其真实性。未知历史预设不能用当前预设替代。
4. 核对后确认设计。修改映射、分组、纳入/排除状态或添加记录将撤销确认。排除记录继续保留原始值与项目附件。
5. 查看原始记录数、纳入记录数、唯一来源图像数、视野数、切片数和有效独立单位数；确认统计口径后导出。

## 汇总与缺失值

顺序固定为：同来源同视野去重 → 切片内各视野等权均值 → 每单位内各切片等权均值 → 每单位向所在组贡献一个值。

例如同一单位有两张切片，视野值分别为 `[10, 20, 30]` 和 `[90]`，单位值为 `(20 + 90) / 2 = 55`；不是把四个视野直接平均得到 `37.5`。该估计目标是切片等权的平均指标，不是合并所有像素后计算的面积比例。应在看结果前确定采样和汇总方案。

- 同来源、同单位/切片/视野且所选指标一致的重复记录只计一次；结果冲突时不任意取首条或平均。
- 同一整图来源映射到不同视野/单位，或同一视野对应不同来源，均阻止推断；尚无重复采集的合并规则。
- 任一预声明视野缺少所选指标时，该单位保留层级信息，但单位值留空，不把剩余视野或切片重新加权。有效零值不当作缺失。
- 原文件哈希只识别字节完全相同的内容，无法识别所有裁剪、重新编码或缩放的同源图，也不能证明生物学独立性。

## 推断条件与边界

只有确认的独立设计、明确存在的对照组、至少两个组且每组至少两个有效单位，才可进入组间推断。空组和不足的组不会被静默剔除。配对及重复测量设计当前只提供描述。nBio=0 不画成零值，nBio=1 不绘制 SD。

两组使用 Welch t 并给出 Mann–Whitney 结果；多组给出 ANOVA/Dunnett 与 Kruskal–Wallis/Holm 结果。检测到多组异方差时普通 ANOVA/Dunnett 不计算；尚未实现 Welch ANOVA。正态性不可计算或 n<8 时为“未知”，未检出偏离不证明分布假设成立。程序的最低 n 门槛不等于足够功效；检验选择需遵循预声明方案。

相同预设只是可比较性必要检查之一，程序不能证明不同图像的染色批次、采样、标定和分析参数可比。不同/未知预设、IF 的占位 RoiMetrics 和非整图 ROI 记录均无法通过本染色路径的范围检查。IF 的规范结果通过独立的设计和指标接口汇总，详见[专用实验单位与统计](if-experimental-units.md)。

## 报告与归档

样本库、图表、诊断 API、Excel、CSV 和中英文 Methods 共用 `sampleStatistics`。Excel 内保留原始记录和设计，并单列切片与单位汇总；只有推断可用时才有推断结果。CSV 的原始值和单位值分开导出。Methods 区分当前图像参数与历史样本库，不能把当前设置写成所有记录共同使用的设置。

项目包保留映射、确认状态、排除状态及已有来源/预设。原图存在时核验其已知 SHA-256；预设必须与该记录保存的历史设置一致。旧项目缺少字段时仍能读取，但不会自动获得独立设计确认。

## Validation scope (English)

Each saved record is a whole-image measurement. Group inference uses one value per explicitly declared independent unit after deduplicating fields, averaging fields within sections, and averaging sections equally within units. Missing declared measurements do not redistribute weights. Confirming the design records the user's declaration; it does not establish biological independence or cross-image comparability.

Only independent designs with a present control and at least two valid units in every group are eligible. IF placeholder metrics, ROI measurements, unknown/mixed profiles and identity conflicts remain descriptive. Paired/repeated designs and Welch ANOVA are not implemented. Exports and APIs share the same aggregation contract. Software tests and synthetic reference calculations establish specified behavior, not biological validity.
