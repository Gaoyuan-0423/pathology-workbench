/**
 * 根据当前全部分析参数生成中/英 Methods 段落——保证论文方法学描述与实际参数一致。
 */
import type { AnalysisResult, ProjectState } from './types.ts';

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

export function generateMethodsZh(project: ProjectState, result: AnalysisResult | null): string {
  const { threshold, segmentation, calibration, image } = project;
  if (!image) return '';
  const thresholdDesc =
    threshold.mode === 'auto'
      ? `采用${METHOD_LABELS[threshold.method] ?? threshold.method}逐图自动确定`
      : threshold.mode === 'manual'
        ? `由分析者手动设定为 ${threshold.manualValue}（0–255 OD 标尺）`
        : threshold.controlThreshold !== null
          ? `由未染色对照片标定：取对照片 DAB 光密度分布的 (1−${threshold.controlFalsePositiveRate}) 分位（阈值 ${threshold.controlThreshold}，对照片 ${threshold.controlImageName ?? '未知'}），并统一应用于全部图像`
          : '对照片未标定，回落为逐图 Otsu';
  const scaleDesc = image.workingScale === 1 ? '1:1' : '1:' + image.workingScale.toFixed(2);
  const lines = [
    `免疫组化图像定量在浏览器端离线完成（Pathology Workbench v0.1，数据不经网络传输）。`,
    `图像（${image.name}，${image.sourceType}）解码后按最长边 ≤4096 px 建立工作图（缩放 ${scaleDesc}），16 位图像按固定 v/257 标尺映射至 8 位，不做逐图对比度拉伸；色彩假定 sRGB。`,
    `经 Ruifrok 颜色去卷积（标准苏木精–DAB 向量）分离 DAB 通道，光密度定义为 OD = 255·ln(255/(I+1))/ln255（0–255 标尺），并按全图 OD 第 ${threshold.backgroundPercentile} 百分位扣除背景。`,
    `DAB 阳性阈值${thresholdDesc}（本次生效阈值 ${result?.thresholdUsed ?? '—'}，0–255）。`,
    `细胞核由苏木精通道逐图 Otsu 阈值（本次 ${result?.nuclearThresholdUsed ?? '—'}）分割，8 连通域标记后按面积 ${segmentation.minAreaPx}–${segmentation.maxAreaPx} px、圆度 ≥ ${segmentation.minCircularity}（4πA/P²，P 为 4 邻域边界边计数周长）门控；核内平均 DAB OD 高于阳性阈值者判为 DAB 阳性核。与图像边界相交的目标按 n + b·n/(n+b) 折算总数（n 为目标数，b 为其中触边者）。`,
    calibration.mpp
      ? `像素尺寸经标定为 ${calibration.mpp} μm/px，据此换算细胞密度（个/mm²）。`
      : '未标定像素尺寸，故未输出绝对密度。',
    `整图及自定义感兴趣区域（ROI）分别输出阳性面积百分比、IOD（积分光密度）、平均 OD、阳性核数与标注指数（阳性核/总核）。`,
  ];
  return lines.join('');
}

export function generateMethodsEn(project: ProjectState, result: AnalysisResult | null): string {
  const { threshold, segmentation, calibration, image } = project;
  if (!image) return '';
  const scaleDesc = image.workingScale === 1 ? '1:1' : '1:' + image.workingScale.toFixed(2);
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
    'The DAB channel was isolated by Ruifrok colour deconvolution with the standard haematoxylin–DAB vectors; optical density was defined as OD = 255·ln(255/(I+1))/ln255 (0–255 scale) and the background was removed by subtracting the ' +
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
  );
  return lines.join(' ');
}
