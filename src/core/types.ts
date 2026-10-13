/**
 * 全项目共享类型。core 层零 DOM 依赖（ImageData 除外——它是结构化克隆对象，可在 Worker 与主线程传递）。
 */

/** 四种自动阈值方法（v1 集合，Kapur 最大熵即 ImageJ 的 MaxEntropy） */
export type AutoThresholdMethod = 'otsu' | 'triangle' | 'mean_sd' | 'kapur';

/** 阈值模式：逐图自动 / 手动 / 对照片标定 */
export type ThresholdMode = 'auto' | 'manual' | 'control';

export interface ThresholdConfig {
  mode: ThresholdMode;
  /** mode = 'auto' 时使用 */
  method: AutoThresholdMethod;
  /** mode = 'manual' 时的阈值，DAB 光密度通道 0–255 标尺 */
  manualValue: number;
  /** 背景扣除百分位（0–25，默认 5），逐通道对 OD 取百分位后减除 */
  backgroundPercentile: number;
  /** mode = 'control'：对照片标定允许的假阳率（默认 0.001，即 0.1%） */
  controlFalsePositiveRate: number;
  /** mode = 'control'：由对照片计算得到的阈值（0–255），null 表示尚未标定 */
  controlThreshold: number | null;
  /** 标定所用的对照片文件名（展示与 Methods 用） */
  controlImageName: string | null;
}

export interface SegmentationConfig {
  /** 核最小面积（工作图像素） */
  minAreaPx: number;
  /** 核最大面积（工作图像素） */
  maxAreaPx: number;
  /** 最小圆度 4πA/P²（0–1） */
  minCircularity: number;
}

export interface Calibration {
  /** 每像素微米数（标尺标定），null 表示未标定 */
  mpp: number | null;
}

export interface Roi {
  id: string;
  name: string;
  /** 工作图坐标系，像素 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** v1 只有 H-DAB；字段为 v1.5 多染色/IF 扩展预留 */
export type StainProfileId = 'h_dab';

export interface StainProfile {
  id: StainProfileId;
  label: string;
  description: string;
}

/** 解码后的工作图元数据（图像本体为 ImageData，随 ProjectState 持久化） */
export interface LoadedImage {
  name: string;
  sourceType: 'PNG' | 'JPEG' | 'TIFF' | 'TIFF16';
  /** 原始全图尺寸 */
  sourceWidth: number;
  sourceHeight: number;
  /** 工作图尺寸（≤4096） */
  workingWidth: number;
  workingHeight: number;
  /** workingWidth / sourceWidth，面积换算与 mpp 折算用 */
  workingScale: number;
  bitsPerSample: number;
  /** 16bit 映射等需在界面与 Methods 中明示的说明 */
  note?: string;
}

/** 单个 ROI（或整图）的量化指标 */
export interface RoiMetrics {
  roiId: string | null;
  roiName: string;
  /** 分析区域内像素数（扣除背景后参与统计的） */
  pixelCount: number;
  /** DAB 阳性像素占比（0–1） */
  positiveFraction: number;
  /** 阳性细胞核数（门控后） */
  positiveNuclei: number;
  /** 全部细胞核数（门控后，含阴性） */
  totalNuclei: number;
  /** 阳性核 / 全部核（0–1），无核时为 null */
  labelingIndex: number | null;
  /** 积分光密度（阈值上 OD 之和，0–255 标尺） */
  integratedOpticalDensity: number;
  /** 平均光密度（阳性像素上的均值，0–255 标尺） */
  meanOpticalDensity: number | null;
  /** 阳性细胞核中触边数量 */
  borderNuclei: number;
  /** 触边目标折算计数修正说明（仅展示用，见 segment.ts） */
  estimatedTotalCount: number | null;
  /** 细胞密度（个/mm²），需 mpp 标定，否则 null */
  densityPerMm2: number | null;
}

/** 组间比较的一组样本值（每组 n = 每图或每 ROI 的某指标） */
export interface ValueGroup {
  name: string;
  values: number[];
}

export interface ProjectState {
  version: 1;
  image: LoadedImage | null;
  /** 工作图像素（RGBA） */
  pixels: ImageData | null;
  profileId: StainProfileId;
  threshold: ThresholdConfig;
  segmentation: SegmentationConfig;
  calibration: Calibration;
  rois: Roi[];
}

/** Worker 一次分析的产出 */
export interface AnalysisResult {
  requestId: number;
  overall: RoiMetrics;
  perRoi: RoiMetrics[];
  /** 实际生效的 DAB 阈值（control 模式可能回落为自动值，见 warnings） */
  thresholdUsed: number;
  /** 核分割实际生效的苏木精阈值（逐图 Otsu） */
  nuclearThresholdUsed: number;
  /** 背景水平（扣除前的 OD 百分位） */
  backgroundLevel: number;
  /** 紫色叠加层，仅阳性像素有 alpha */
  overlay: ImageData | null;
  warnings: string[];
}

export const STAIN_PROFILES: StainProfile[] = [
  {
    id: 'h_dab',
    label: 'H-DAB（苏木精–DAB 免疫组化）',
    description: 'Ruifrok 颜色去卷积分离苏木精与 DAB，在 DAB 光密度通道上定量',
  },
];

export const DEFAULT_THRESHOLD: ThresholdConfig = {
  mode: 'auto',
  method: 'otsu',
  manualValue: 40,
  backgroundPercentile: 5,
  controlFalsePositiveRate: 0.001,
  controlThreshold: null,
  controlImageName: null,
};

export const DEFAULT_SEGMENTATION: SegmentationConfig = {
  minAreaPx: 24,
  maxAreaPx: 2400,
  minCircularity: 0.08,
};

export function createEmptyProject(): ProjectState {
  return {
    version: 1,
    image: null,
    pixels: null,
    profileId: 'h_dab',
    threshold: { ...DEFAULT_THRESHOLD },
    segmentation: { ...DEFAULT_SEGMENTATION },
    calibration: { mpp: null },
    rois: [],
  };
}
