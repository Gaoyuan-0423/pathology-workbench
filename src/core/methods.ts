/**
 * 根据当前全部分析参数生成中/英 Methods 段落——保证论文方法学描述与实际参数一致。
 */
import { t } from '../i18n.ts';
import { METRIC_LABELS } from './api-labels.ts';
import { sampleStatistics } from './sample-statistics.ts';
import { ifSampleStatistics } from './if-statistics.ts';
import { IF_METRIC_LABELS } from './if-report-labels.ts';
import type { AnalysisResult, ColocConfig, IfAnalysisResult, IfSampleRecord, LoadedImage, MetricKey, ProjectState } from './types.ts';

const METHOD_LABELS: Record<string, string> = {
  otsu: 'Otsu 类间方差法',
  triangle: 'Triangle 峰谷距法',
  mean_sd: '均值+2 标准差法',
  kapur: 'Kapur 最大熵法',
};

const METHOD_NAMES_EN: Record<string, string> = {
  otsu: "Otsu's inter-class variance method",
  triangle: 'the triangle method',
  mean_sd: 'the mean + 2 SD rule',
  kapur: "Kapur's maximum-entropy method",
};

export function generateMethodsZh(project: ProjectState, result: AnalysisResult | null, metric: MetricKey = 'positiveFraction'): string {
  return appendSampleMethods(currentImageMethodsZh(project, result), project, metric, 'zh');
}

export function generateMethodsEn(project: ProjectState, result: AnalysisResult | null, metric: MetricKey = 'positiveFraction'): string {
  return appendSampleMethods(currentImageMethodsEn(project, result), project, metric, 'en');
}

function appendSampleMethods(current: string, project: ProjectState, metric: MetricKey, language: 'zh' | 'en'): string {
  if (!project.samples.length && !project.ifSamples?.length && !project.ifExperimentalDesign) return current;
  const scope = language === 'zh'
    ? '图像方法适用范围：上段仅描述当前图像的本次分析，不代表样本库全部记录采用相同设置。'
    : 'Image-method scope: the preceding paragraph describes the current image analysis only; it does not establish that all saved records used the same settings.';
  return [current, ...(current ? [scope] : []),
    ...(project.samples.length ? [generateSampleMethods(project, metric, language)] : []),
    ...((project.ifSamples?.length || project.ifExperimentalDesign) ? [generateIfStatisticsMethods(project, language)] : []),
    ...(project.ifSamples ?? []).map((sample) => generateIfSampleMethods(sample, language)),
  ].filter(Boolean).join('\n\n');
}

/** IF study statistics use the same dedicated helper as API and exports. */
export function generateIfStatisticsMethods(project: ProjectState, language: 'zh' | 'en'): string {
  const { aggregation, report, counts, groupCounts, inference } = ifSampleStatistics(project.ifSamples ?? [], project.ifExperimentalDesign);
  const shown = (value: number | null) => value === null ? (language === 'zh' ? '未确认' : 'unconfirmed') : String(value);
  const metric = t(IF_METRIC_LABELS[aggregation.metric], language);
  const summary = groupCounts.map((group) => `${group.group}: nBio=${shown(group.nBio)}, nImages=${shown(group.nImages)}, nRecords=${group.nRecords}`).join('; ');
  const countsText = `nBio=${shown(counts.nBio)}, nImages=${shown(counts.nImages)}, nRecords=${counts.nRecords}, nSections=${shown(counts.nSections)}, nFields=${shown(counts.nFields)}, nRegions=${shown(counts.nRegions)}`;
  const lines = language === 'zh'
    ? [`IF 样本库统计范围：仅使用专用 IF 记录，所选指标为${metric}，区域模式为 ${aggregation.regionMode}。${countsText}。全部记录中纳入 ${counts.nIncludedRecords} 条、排除 ${counts.nExcludedRecords} 条；nBio 仅计该指标可用的独立单位，图像数、ROI 数与记录数不是独立样本量。${summary ? `各组：${summary}。` : ''}`]
    : [`IF saved-record statistics used dedicated IF records only, with ${metric} as the selected metric and ${aggregation.regionMode} as the region mode. ${countsText}. Records comprised ${counts.nIncludedRecords} included and ${counts.nExcludedRecords} excluded entries; nBio counts independent units with a usable selected-metric value. Image, ROI and record counts are not independent sample sizes.${summary ? ` Groups: ${summary}.` : ''}`];
  if (aggregation.measurementLevel === 'biological_unit') {
    lines.push(language === 'zh'
      ? `实验者声明并确认独立组设计、对照组 ${project.ifExperimentalDesign!.controlGroup} 及来源—视野—切片—单位映射；配置一致性检查是必要条件，不证明图像采集条件或生物学可比性相同。${aggregation.regionMode === 'equal_rois' ? '每个视野对显式选定且互不重叠的 ROI 系数作算术等权平均，不按面积或像素数加权。' : '每个视野使用整图系数，不纳入 ROI 系数。'}同一来源视野的重复记录合并一次；切片内视野等权，单位内切片等权，每个单位向所属组贡献一个值。未进行 Fisher 变换或像素池化，因此此估计量为系数的层级算术平均，不是合并像素的相关系数。预声明区域或视野缺值时，相关单位保留为空，不把缺失值替换为零，也不重新分配权重。`
      : `The analyst declared and confirmed an independent-group design, control group ${project.ifExperimentalDesign!.controlGroup}, and the source–field–section–unit mapping. Matching analysis settings are necessary but do not establish matching acquisition conditions or biological comparability. ${aggregation.regionMode === 'equal_rois' ? 'Within each field, coefficients from explicitly selected, nonoverlapping ROIs were averaged arithmetically with equal weights, without area or pixel weighting.' : 'Each field used its whole-image coefficient; ROI coefficients were not included.'} Duplicate records of the same source field were counted once; fields were weighted equally within sections and sections equally within units, with one value per unit entering its group. No Fisher transformation or pixel pooling was used: the estimand is a hierarchical arithmetic mean of coefficients, not a pooled-pixel correlation. Missing prespecified region or field values leave the corresponding unit value missing, without zero substitution or redistribution of weights.`);
  } else {
    lines.push(language === 'zh'
      ? '当前未建立可用于推断的 IF 单位层级；记录或区域描述不代表生物学重复，未从当前图像设置或染色统计结果补造 IF 单位。'
      : 'An IF unit hierarchy eligible for inference has not been established. Record or region descriptions do not represent biological replication; IF units were not inferred from current-image settings or stain statistics.');
  }
  if (inference) {
    const tests = [report.omnibusParametric?.label, report.omnibusNonParametric?.label].filter((label): label is string => Boolean(label)).map((label) => t(label, language));
    if (report.pairwise.some((pair) => pair.method === 'dunnett')) tests.push('Dunnett');
    if (report.pairwise.some((pair) => pair.method === 'holm-mw')) tests.push('Mann–Whitney + Holm');
    lines.push(language === 'zh'
      ? `IF 组间检验基于单位均值，全部组均至少有 2 个可用独立单位；本次计算 ${tests.join('；')}。这只是软件推断门槛，不表示样本量或检验效力充分；仅支持独立组，配对和重复测量设计不在本次实现范围。设计确认不自动证明抽样独立性或科学结论有效。`
      : `IF group tests used unit means, with at least two usable independent units in every group; this report calculated ${tests.join('; ')}. This is a software eligibility threshold, not evidence of adequate sample size or power. Only independent groups are supported; paired and repeated-measures designs are outside this implementation. Design confirmation does not establish sampling independence or the validity of scientific conclusions.`);
  } else {
    lines.push(language === 'zh'
      ? `IF 当前仅提供描述统计，不输出 IF 组间推断 p 值或显著性；设计状态 ${aggregation.designStatus}，推断状态 ${report.inferenceStatus}。`
      : `IF results currently provide descriptive statistics only, without IF group-inference p values or significance; design status is ${aggregation.designStatus} and inference status is ${report.inferenceStatus}.`);
  }
  const issues = [...aggregation.issues, ...report.issues];
  lines.push(t(report.recommendation, language));
  if (issues.length) lines.push(issues.map((issue) => `[${issue.code}] ${t(issue.message, language)}`).join(language === 'zh' ? '；' : '; '));
  return lines.filter(Boolean).join(language === 'zh' ? '' : ' ');
}

/** Study-level aggregation is separate from the current image's analysis settings. */
export function generateSampleMethods(project: ProjectState, metric: MetricKey, language: 'zh' | 'en'): string {
  const { aggregation, report, counts, groupCounts, inference } = sampleStatistics(project.samples, metric, project.experimentalDesign);
  const unknown = language === 'zh' ? '未确认' : 'unconfirmed';
  const shown = (value: number | null) => value === null ? unknown : String(value);
  const metricName = t(METRIC_LABELS[metric], language);
  const summary = groupCounts.map((group) => `${group.group}: nBio=${shown(group.nBio)}, nImages=${shown(group.nImages)}, nRecords=${group.nRecords}`).join('; ');
  const issues = [...aggregation.issues, ...report.issues].map((issue) => issue.code);
  const issueText = issues.length ? ` [${[...new Set(issues)].join(', ')}]` : '';
  const countsText = `nBio=${shown(counts.nBio)}, nImages=${shown(counts.nImages)}, nRecords=${counts.nRecords}`;
  const lines = language === 'zh'
    ? [`样本库统计范围：指标为${metricName}；${countsText}。nImages 为纳入记录中来源身份可核对的去重图像数，nRecords 为保存的全部分析记录数（纳入 ${counts.nIncludedRecords}，排除 ${counts.nExcludedRecords}）；二者均不代表生物学样本量。${summary ? `各组：${summary}。` : ''}`]
    : [`Saved-record statistics: the selected metric was ${metricName}; ${countsText}. nImages denotes unique source images with known identities among included records, and nRecords denotes all saved analysis records (${counts.nIncludedRecords} included, ${counts.nExcludedRecords} excluded); neither count represents biological replication.${summary ? ` Groups: ${summary}.` : ''}`];
  if (project.samples.some((sample) => sample.profileId === 'if_coloc')) {
    lines.push(language === 'zh'
      ? 'IF 共定位记录不提供这些染色指标；兼容字段中的 Manders M1 与占位值不作为阳性面积、IOD 或细胞核测量显示，也不参与这些指标的描述统计或组间推断。'
      : 'IF colocalization records do not provide these stain metrics. Manders M1 and placeholders in compatibility fields are not presented as positive area, IOD or nuclear measurements, and do not enter descriptive statistics or group inference for these metrics.');
  }
  if (aggregation.measurementLevel === 'biological_unit') {
    lines.push(language === 'zh'
      ? `实验者声明并确认独立组设计及单位、切片、视野映射。同一来源的重复视野仅计一次，切片内视野等权求均值，再对每个单位的切片等权求均值；每个单位向所属组贡献一个数值。共映射 ${counts.nUnitsMapped} 个单位、${counts.nSections} 张切片、${counts.nFields} 个视野。nBio 仅计所选指标可用的单位；预声明视野缺值时该单位指标保留为空，不重新分配权重。`
      : `The analyst declared and confirmed an independent-group design and the unit, section and field mapping. Duplicate records of the same source field were counted once; fields were averaged equally within each section, then section means equally within each unit. Each unit contributed one value to its group. The mapping contained ${counts.nUnitsMapped} units, ${counts.nSections} sections and ${counts.nFields} fields. nBio counts only units with a usable selected metric; a missing predeclared field value leaves the unit metric missing without redistributing weights.`);
  }
  if (!inference) {
    lines.push(language === 'zh'
      ? `当前仅提供描述统计，不输出组间推断 p 值或显著性。设计状态为 ${aggregation.designStatus}，推断状态为 ${report.inferenceStatus}。${issueText}`
      : `Only descriptive statistics are provided; no group-inference p values or significance are reported. Design status is ${aggregation.designStatus}; inference status is ${report.inferenceStatus}.${issueText}`);
  } else {
    const tests = [report.omnibusParametric?.label, report.omnibusNonParametric?.label].filter((label): label is string => Boolean(label)).map((label) => t(label, language));
    if (report.pairwise.some((pair) => pair.method === 'dunnett')) tests.push('Dunnett');
    if (report.pairwise.some((pair) => pair.method === 'holm-mw')) tests.push('Mann–Whitney + Holm');
    lines.push(language === 'zh'
      ? `组间检验基于单位均值，全部组均至少有 2 个所选指标可用的独立单位；指定对照组为 ${project.experimentalDesign!.controlGroup}。本次报告计算 ${tests.join('；')}。实验者确认只记录设计声明，不能据此自动认定抽样独立性或科学结论有效。${issueText}`
      : `Between-group tests used unit means, with at least two units having usable selected-metric values in every group; the declared control group was ${project.experimentalDesign!.controlGroup}. The report calculated ${tests.join('; ')}. Analyst confirmation records the design declaration; it does not automatically establish sampling independence or the validity of scientific conclusions.${issueText}`);
  }
  return lines.join(language === 'zh' ? '' : ' ');
}

function currentImageMethodsZh(project: ProjectState, result: AnalysisResult | null): string {
  const { threshold, segmentation, calibration, image } = project;
  if (!image) return '';
  if (!result) return '当前输入与设置尚无有效分析结果；未生成本次分析的 Methods。请完成分析后重新导出。历史样本结果保留各自的分析设置。';
  if (project.profileId === 'if_coloc') return colocMethods(project, result, 'zh');
  const thresholdDesc =
    threshold.mode === 'auto'
      ? `采用${METHOD_LABELS[threshold.method] ?? threshold.method}逐图自动确定`
      : threshold.mode === 'manual'
        ? `由分析者手动设定为 ${threshold.manualValue}（0–255 OD 标尺）`
        : threshold.controlThreshold !== null
          ? `由未染色对照片标定：取对照片 DAB 光密度分布的 (1−${threshold.controlFalsePositiveRate}) 分位（阈值 ${threshold.controlThreshold}，对照片 ${threshold.controlImageName ?? '未知'}），并统一应用于全部图像`
          : '对照片未标定，回落为逐图 Otsu';
  const scaleDesc = image.workingScale === 1 ? '1:1' : '1:' + image.workingScale.toFixed(2);
  const override = project.stainOverrides[project.profileId];
  const vectorDesc = override
    ? `用户自定义向量（第一染色 ${override[0].map((v) => v.toFixed(3)).join('/')}，第二染色 ${override[1].map((v) => v.toFixed(3)).join('/')}）`
    : '预设文献向量';
  const lines = [
    `免疫组化图像定量在浏览器端离线完成（Pathology Workbench v0.1，数据不经网络传输）。`,
    `图像（${image.name}，${image.sourceType}）解码后按最长边 ≤4096 px 建立工作图（缩放 ${scaleDesc}），16 位图像按固定 v/257 标尺映射至 8 位，不做逐图对比度拉伸；色彩假定 sRGB。`,
    `经 Ruifrok 颜色去卷积（${vectorDesc}）分离 DAB 通道，光密度定义为 OD = 255·ln(255/(I+1))/ln255（0–255 标尺），并按全图 OD 第 ${threshold.backgroundPercentile} 百分位扣除背景。`,
    `DAB 阳性阈值${thresholdDesc}（本次生效阈值 ${result?.thresholdUsed ?? '—'}，0–255）。`,
    `细胞核由苏木精通道逐图 Otsu 阈值（本次 ${result?.nuclearThresholdUsed ?? '—'}）分割，8 连通域标记后按面积 ${segmentation.minAreaPx}–${segmentation.maxAreaPx} px、圆度 ≥ ${segmentation.minCircularity}（4πA/P²，P 为 4 邻域边界边计数周长）门控；核内平均 DAB OD 高于阳性阈值者判为 DAB 阳性核。与图像边界相交的目标按 n + b·n/(n+b) 折算总数（n 为目标数，b 为其中触边者）。`,
    calibration.mpp
      ? `像素尺寸经标定为 ${calibration.mpp} μm/px，据此换算细胞密度（个/mm²）。`
      : '未标定像素尺寸，故未输出绝对密度。',
    `整图及自定义感兴趣区域（ROI）分别输出阳性面积百分比、IOD（积分光密度）、平均 OD、阳性核数与标注指数（阳性核/总核）。`,
    `H-score（0–300）按核级强度计：阳性核的核内平均 OD 在阳性区间 [阈值, 255] 内三等分为弱/中/强，分别计 1/2/3 分，按全部计数核（含阴性）百分比加权和。`,
  ];
  if (result.aiUsed) lines[4] = `细胞核使用本机 AI 模型 ${result.aiModelLoaded ?? '未知'}（内容 SHA-256：${result.aiModelId ?? '历史记录未提供'}）输出的概率图，以 0.5 转为掩膜；` + lines[4].slice(lines[4].indexOf('8 连通域'));
  if (result.aiRequested && !result.aiUsed) lines.push('本次请求 AI 分割但实际使用了 Otsu 回落结果，请核对分析警告。');
  return lines.join('');
}

function currentImageMethodsEn(project: ProjectState, result: AnalysisResult | null): string {
  const { threshold, segmentation, calibration, image } = project;
  if (!image) return '';
  if (!result) return 'No valid analysis result is available for the current inputs and settings. Methods for this analysis were not generated; complete analysis and export again. Historical samples retain their own analysis settings.';
  if (project.profileId === 'if_coloc') return colocMethods(project, result, 'en');
  const scaleDesc = image.workingScale === 1 ? '1:1' : '1:' + image.workingScale.toFixed(2);
  const override = project.stainOverrides[project.profileId];
  const vectorDesc = override
    ? 'user-adjusted vectors (stain 1: ' + override[0].map((v) => v.toFixed(3)).join('/') + '; stain 2: ' + override[1].map((v) => v.toFixed(3)).join('/') + ')'
    : 'standard literature vectors';
  let thresholdDesc: string;
  if (threshold.mode === 'auto') {
    thresholdDesc = 'determined per image by ' + (METHOD_NAMES_EN[threshold.method] ?? threshold.method);
  } else if (threshold.mode === 'manual') {
    thresholdDesc = 'set manually to ' + threshold.manualValue + ' (0–255 OD scale)';
  } else if (threshold.controlThreshold !== null) {
    thresholdDesc =
      'calibrated from an unstained control slide (' + (threshold.controlImageName ?? 'unknown') +
      ') as the (1−' + threshold.controlFalsePositiveRate + ') quantile of its DAB optical-density distribution (threshold ' +
      threshold.controlThreshold + ') and applied uniformly';
  } else {
    thresholdDesc = 'fell back to per-image Otsu because no control slide was calibrated';
  }

  const lines: string[] = [];
  lines.push('Immunohistochemistry quantification was performed offline in the browser (Pathology Workbench v0.1; no data left the local machine).');
  lines.push(
    'Images (' + image.name + ', ' + image.sourceType + ') were decoded and a working image with a longest edge of 4096 px or less was built (scale ' +
      scaleDesc + '); 16-bit data were mapped to 8 bit with the fixed v/257 scale (no per-image contrast stretching), assuming sRGB.',
  );
  lines.push(
    'The DAB channel was isolated by Ruifrok colour deconvolution with ' + vectorDesc.replace('user-adjusted vectors', 'user-adjusted stain vectors') + '; deconvolution used the haematoxylin–DAB basis; optical density was defined as OD = 255·ln(255/(I+1))/ln255 (0–255 scale) and the background was removed by subtracting the ' +
      threshold.backgroundPercentile + 'th percentile of whole-image OD.',
  );
  lines.push('The DAB positivity threshold was ' + thresholdDesc + ' (effective threshold ' + (result?.thresholdUsed ?? '—') + ').');
  lines.push(
    'Nuclei were segmented from the haematoxylin channel by per-image Otsu thresholding (this run: ' + (result?.nuclearThresholdUsed ?? '—') +
      '), labelled with 8-connected component analysis, and gated by area ' + segmentation.minAreaPx + '–' + segmentation.maxAreaPx +
      ' px and circularity ≥ ' + segmentation.minCircularity + ' (4πA/P², with P the 4-neighbour boundary-edge perimeter). ' +
      'A nucleus was scored DAB-positive when its mean intra-nuclear DAB OD exceeded the positivity threshold. ' +
      'Objects touching the image border were accounted for by the finite-count correction n + b·n/(n+b).',
  );
  if (calibration.mpp) {
    lines.push('The pixel size was calibrated to ' + calibration.mpp + ' μm/px for density estimates (nuclei/mm²).');
  } else {
    lines.push('Absolute densities were not reported because the pixel size was not calibrated.');
  }
  lines.push(
    'Positive-area percentage, integrated optical density (IOD), mean OD, positive-nucleus counts and the labelling index (positive/total nuclei) were reported for whole images and user-drawn regions of interest.',
    'An H-score (0–300) was computed per nucleus: positive nuclei were graded weak/moderate/strong by equal thirds of the positive OD interval [threshold, 255], scored 1/2/3, and the percentages of all counted nuclei (negatives included) were summed with these weights.',
  );
  if (result.aiUsed) lines[4] = 'Nuclei were segmented from probabilities produced by the local AI model ' + (result.aiModelLoaded ?? 'unknown') + ' (content SHA-256: ' + (result.aiModelId ?? 'not recorded in legacy result') + '), using a probability threshold of 0.5, ' + lines[4].slice(lines[4].indexOf('labelled with'));
  if (result.aiRequested && !result.aiUsed) lines.push('AI segmentation was requested, but this result used the Otsu fallback; review the analysis warnings.');
  return lines.join(' ');
}

function colocMethods(project: ProjectState, result: AnalysisResult, language: 'zh' | 'en'): string {
  const { coloc, image } = project;
  if (result.ifAnalysis) return generateIfAnalysisMethods(image!.name, image, coloc, result.ifAnalysis, language);
  if (!result.coloc) return language === 'zh'
    ? '当前结果没有可用的 IF 共定位测量；未由染色兼容字段生成 IF Methods。'
    : 'The current result has no available IF colocalization measurements; IF Methods were not generated from stain compatibility fields.';
  const legacy = result.coloc;
  const channels = ['R', 'G', 'B'];
  return language === 'zh'
    ? `图像 ${image!.name} 仅有旧格式整图 IF 结果，通道 A/B 为 ${channels[legacy.channelA]}/${channels[legacy.channelB]}，记录的背景 A/B 为 ${legacy.backgroundA}/${legacy.backgroundB}，生效 A/B 阈值为 ${legacy.thresholdA}/${legacy.thresholdB}。该结果不含规范 ROI 测量、区域像素数或未定义原因；不能根据当前绘制的 ROI 补造历史测量。旧系数按原记录保留，缺少分母信息时不能追溯判断旧零值是否为占位。此旧格式测量仅用于描述，不能转换为 IF 实验单位输入。IF 不使用 AI 核分割。`
    : `Image ${image!.name} has only a legacy whole-image IF result, using channels ${channels[legacy.channelA]}/${channels[legacy.channelB]} as A/B, recorded backgrounds ${legacy.backgroundA}/${legacy.backgroundB}, and effective A/B thresholds ${legacy.thresholdA}/${legacy.thresholdB}. This result has no canonical ROI measurements, region pixel counts or undefined-value reasons; historical measurements cannot be reconstructed from currently drawn ROIs. Legacy coefficients are retained as recorded; without denominators, legacy zeros cannot retrospectively be distinguished from placeholders. This legacy measurement is descriptive only and cannot be converted into an IF experimental-unit input. IF does not use AI nuclear segmentation.`;
}

/** Parameters come from the matching current run or the saved IF record itself. */
export function generateIfAnalysisMethods(imageName: string, image: LoadedImage | null, config: ColocConfig, analysis: IfAnalysisResult, language: 'zh' | 'en'): string {
  const { overall, perRoi, imageWidth, imageHeight } = analysis;
  const channels = ['R', 'G', 'B'];
  const mode = language === 'zh' ? config.thresholdMode === 'auto' ? '整图逐通道 Otsu' : '手动' : config.thresholdMode === 'auto' ? 'per-channel whole-image Otsu' : 'manual';
  const source = image ? `${image.sourceType}, ${image.sourceWidth}×${image.sourceHeight}, ${image.bitsPerSample}-bit` : '';
  const intensityScale = language === 'zh'
    ? `RGB 工作通道使用 8 位（0–255）强度标尺。${image?.bitsPerSample === 16 ? '16 位原图按固定 v/257 映射到 8 位，不做逐图对比度拉伸。' : ''}`
    : `Working RGB channels use an 8-bit (0–255) intensity scale.${image?.bitsPerSample === 16 ? ' The 16-bit source is mapped to 8 bit using the fixed v/257 scale, without per-image contrast stretching.' : ''}`;
  return language === 'zh'
    ? `IF 共定位针对图像 ${imageName}${source ? `（${source}）` : ''} 的 ${imageWidth}×${imageHeight} RGB 工作图计算，通道 A/B 为 ${channels[overall.channelA]}/${channels[overall.channelB]}。${intensityScale}各通道先按整张工作图第 ${config.backgroundPercentile} 百分位扣除背景（实际 A/B 背景 ${overall.backgroundA}/${overall.backgroundB}），负值截为 0；阈值方式为${mode}，实际 A/B 阈值 ${overall.thresholdA}/${overall.thresholdB}。背景与阈值以整图为固定参考，随后应用于整图及 ${perRoi.length} 个矩形 ROI，不在 ROI 内重新估计。ROI 以实际裁剪后的整数半开像素范围记录；每个区域分别报告像素数、A/B 阳性像素数、阳性并集与交集像素数。阳性定义为背景扣除后强度严格大于对应阈值。全像素 Pearson 使用区域内全部像素，掩膜 Pearson 使用 A 或 B 阳性的并集；Manders M1 为 B 阳性区域的 A 强度和除以区域总 A 强度，M2 对称定义。Pearson 像素不足 2 个或任一通道零方差、Manders 分母为零时，系数保留为空并记录原因。本段描述整图及 ROI 的测量口径，IF 组间推断另见已确认设计的单位统计。同一图像的多个 ROI、重叠 ROI 和重复保存记录均不代表独立生物学重复，不直接计入 nBio。IF 不使用 AI 核分割。`
    : `IF colocalization was calculated for the ${imageWidth}×${imageHeight} RGB working image ${imageName}${source ? ` (${source})` : ''}, using channels ${channels[overall.channelA]}/${channels[overall.channelB]} as A/B. ${intensityScale} The ${config.backgroundPercentile}th percentile of each whole-image channel was subtracted as background (actual A/B backgrounds ${overall.backgroundA}/${overall.backgroundB}), clipping negative values to zero. Thresholding was ${mode}, with actual A/B thresholds ${overall.thresholdA}/${overall.thresholdB}. Backgrounds and thresholds were fixed from the whole image and then applied to the whole image and ${perRoi.length} rectangular ROIs, without re-estimation within ROIs. Actual clipped integer, half-open pixel bounds were retained for each ROI. Each region reports its pixel count, A/B-positive counts, and union and intersection counts. Positivity means background-corrected intensity strictly greater than the corresponding threshold. All-pixel Pearson uses all regional pixels; masked Pearson uses the union of A-positive or B-positive pixels. Manders M1 is summed A intensity in B-positive pixels divided by total regional A intensity; M2 is defined symmetrically. Pearson coefficients with fewer than two pixels or zero variance in either channel, and Manders coefficients with a zero denominator, remain missing with recorded reasons. This paragraph describes whole-image and ROI measurement methods; IF group inference is reported separately through confirmed unit statistics. Multiple or overlapping ROIs from one image and repeated saved records do not represent independent biological replicates and are not directly counted as nBio. IF does not use AI nuclear segmentation.`;
}

export function generateIfSampleMethods(sample: IfSampleRecord, language: 'zh' | 'en'): string {
  const prefix = language === 'zh'
    ? `保存的 IF 记录 ${sample.name}（记录 ID ${sample.id}，分组 ${sample.group}，来源 ID ${sample.sourceId}，${sample.excludedFromStatistics ? '已排除于统计' : '纳入统计候选'}）使用该记录自身保存的配置与区域结果。`
    : `Saved IF record ${sample.name} (record ID ${sample.id}, group ${sample.group}, source ID ${sample.sourceId}; ${sample.excludedFromStatistics ? 'excluded from statistics' : 'included as a candidate for statistics'}) uses its own saved configuration and regional results.`;
  return `${prefix}${language === 'en' ? ' ' : ''}${generateIfAnalysisMethods(sample.imageName, sample.image, sample.config, sample.analysis, language)}`;
}
