# Pathology Workbench · 病理工作台

离线免疫组化（IHC）H-DAB 定量、细胞核分割计数、组间统计检验与出版级导出的**纯前端网页工具**。所有计算在浏览器本地完成，图像数据不经任何网络传输。

## 功能

- **导入**：PNG / JPEG / TIFF（8 与 16 bit，多页取最大页）。16 bit 按固定 v/257 标尺映射到 8 bit，**不做逐图对比度拉伸**；厂商全切片格式（.svs/.ndpi/.mrxs 等）请先从采集软件导出普通 TIFF
- **颜色去卷积**：Ruifrok 2001 标准苏木精–DAB 向量，在 DAB 光密度通道（OD = 255·ln(255/(I+1))/ln255，0–255 标尺）上定量
- **背景扣除**：全图 OD 百分位（默认 5）
- **阳性阈值**：Otsu / Triangle / 均值+2σ / Kapur 最大熵 逐图自动；手动；**未染色对照片自动标定**（按允许假阳率取对照分布分位，默认 0.1%）
- **细胞核分割**：苏木精通道逐图 Otsu + 8 连通域；面积/圆度门控；**触边目标边界折算计数**（n + b·n/(n+b)）；标定 μm/px 后输出细胞密度（个/mm²）
- **多 ROI**：画布框选，逐 ROI 与整图并行统计
- **组间统计**：样本库分组后一键比较——Welch t / 单因素 ANOVA + Dunnett（参数路径）、Mann-Whitney U / Kruskal-Wallis + Holm 校正全对比较（非参数路径）、Levene 方差齐性、D'Agostino–Pearson 正态性，并自动给出检验选择建议
- **出版导出**：Excel（样本指标 / 统计检验 / Methods / 项目信息四表）、CSV、柱状图（均值 ± SD + 显著性星标）SVG 与 PNG、阳性掩膜叠加 PNG、**中英双语 Methods 方法学文本**（与实际参数逐项一致）

## 方法学要点

| 项目 | 定义 |
|---|---|
| 光密度 | OD = 255·ln(255/(I+1))/ln255，0–255 标尺（Ruifrok 惯例，+1 钳制） |
| 去卷积向量 | 苏木精 (0.684, 0.696, 0.183)、DAB (0.250, 0.500, 0.850)，残差向量取正交补 |
| 阳性判定 | DAB OD 严格大于阈值（背景已扣除） |
| 圆度 | 4πA/P²，P 为 4 邻域边界边计数周长（系统性偏低估，门控默认值宽松） |
| 边界折算 | estimated = n + b·n/(n+b) |
| 阳性核 | 核内平均 DAB OD > 阳性阈值 |

正态性检验为 D'Agostino–Pearson K²（建议 n ≥ 8）；Mann-Whitney 正态近似建议每组 n ≥ 8。

## 隐私与数据纪律

- 纯前端 + IndexedDB 本地自动保存，无任何网络请求（更新检查仅在打包版通过 CI 注入，网页部署不包含）
- 本仓库测试全部使用**程序化合成图像**，不含真实实验数据

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest 单元测试（算法手算对照）
npm run build      # tsc -b && vite build
npx playwright test  # E2E 冒烟（自动起 dev server）
npm run lint       # oxlint
```

## 部署

GitHub Actions 两段式：`ci.yml`（单元测试 + 构建 + E2E）产出经校验的 `web-dist` artifact；`pages.yml` 手动 dispatch、校验指定 main 提交确有成功 CI 后才部署该构建到 GitHub Pages——只部署验证过的版本。

## 许可

见 LICENSE（待定；算法均为公开文献方法，Ruifrok 向量与统计检验实现不依赖第三方受限代码）。
