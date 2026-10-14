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


/** 共定位分析结果（转引自 colocalize.ts 的结构） */
export interface ColocResult {
  channelA: number;
  channelB: number;
  pearsonAll: number;
  pearsonMasked: number;
  mandersM1: number;
  mandersM2: number;
  thresholdA: number;
  thresholdB: number;
  backgroundA: number;
  backgroundB: number;
}

/** IF 共定位配置（profileId = 'if_coloc' 时生效） */
export interface ColocConfig {
  /** 通道 0=R 1=G 2=B */
  channelA: 0 | 1 | 2;
  channelB: 0 | 1 | 2;
  /** 逐通道阈值：auto = 各自 Otsu；manual = 用 manualA/B */
  thresholdMode: 'auto' | 'manual';
  manualA: number;
  manualB: number;
  /** 逐通道背景百分位（0–25，默认 5） */
  backgroundPercentile: number;
}

export const DEFAULT_COLOC: ColocConfig = {
  channelA: 0,
  channelB: 1,
  thresholdMode: 'auto',
  manualA: 40,
  manualB: 40,
  backgroundPercentile: 5,
};

export interface Roi {
  id: string;
  name: string;
  /** 工作图坐标系，像素 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** v1.5 染色预设；向量均取公开文献惯例值，第三残差向量由引擎正交补全 */
export type StainProfileId = 'h_dab' | 'h_eosin' | 'masson' | 'if_coloc';

export interface StainProfile {
  id: StainProfileId;
  label: string;
  description: string;
  /** 去卷积双色向量（RGB，引擎内归一化）；IF 共定位不使用 */
  stains: [Vec3, Vec3] | null;
  /** 定量通道索引（0 = 第一染色，1 = 第二染色） */
  quantifyChannel: 0 | 1;
  /** 定量通道展示名（用于指标标签与 Methods） */
  quantifyLabel: string;
  /** 向量出处（界面与 Methods 明示） */
  source: string;
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

/** 可做组间比较的指标 */
export type MetricKey =
  | 'positiveFraction'
  | 'labelingIndex'
  | 'integratedOpticalDensity'
  | 'meanOpticalDensity'
  | 'densityPerMm2';

/** 样本库条目：一张图分析完成后的整图指标（像素不入库，避免膨胀） */
export interface SampleRecord {
  id: string;
  name: string;
  group: string;
  imageName: string;
  addedAt: number;
  metrics: RoiMetrics;
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
  coloc: ColocConfig;
  /** 用户自定义染色向量覆盖（键为 profileId；仅染色预设生效） */
  stainOverrides: Partial<Record<StainProfileId, [Vec3, Vec3]>>;
  rois: Roi[];
  samples: SampleRecord[];
}

/** Worker 一次分析的产出 */
export interface AnalysisResult {
  requestId: number;
  overall: RoiMetrics;
  perRoi: RoiMetrics[];
  /** 实际生效的定量通道阈值（control 模式可能回落为自动值，见 warnings）；IF 模式为通道 A 阈值 */
  thresholdUsed: number;
  /** 核分割实际生效的苏木精阈值（逐图 Otsu）；IF 模式为通道 B 阈值 */
  nuclearThresholdUsed: number;
  /** 背景水平（扣除前的 OD 百分位）；IF 模式为通道 A 背景 */
  backgroundLevel: number;
  /** 叠加层：染色预设为阳性填充，IF 为双通道掩膜 */
  overlay: ImageData | null;
  /** 仅 if_coloc 模式非空 */
  coloc: ColocResult | null;
  warnings: string[];
}

/** 根类型（color.ts 内部引用类型），避免 core 循环依赖 */
export type Vec3 = [number, number, number];

export const STAIN_PROFILES: StainProfile[] = [
  {
    id: 'h_dab',
    label: 'H-DAB 免疫组化',
    description: '分离苏木精与 DAB，在 DAB 光密度通道上定量阳性面积与阳性核',
    stains: [[0.684, 0.696, 0.183], [0.25, 0.5, 0.85]],
    quantifyChannel: 1,
    quantifyLabel: 'DAB',
    source: 'Ruifrok & Johnston 2001',
  },
  {
    id: 'h_eosin',
    label: 'H&E 苏木精-伊红',
    description: '分离苏木精与伊红，可在伊红通道上定量胞质/间质染色面积',
    stains: [[0.65, 0.7, 0.29], [0.07, 0.99, 0.11]],
    quantifyChannel: 1,
    quantifyLabel: '伊红',
    source: 'Ruifrok 惯例值（skimage rgb_from_hed 同源）',
  },
  {
    id: 'masson',
    label: 'Masson 三色',
    description: '分离苏木精与苯胺蓝，在蓝色通道上定量纤维化（胶原）面积',
    stains: [[0.55, 0.49, 0.27], [0.4, 0.7, 0.59]],
    quantifyChannel: 1,
    quantifyLabel: '苯胺蓝',
    source: 'Ruifrok 三色惯例值（因染色协议而异，建议用对照片验证）',
  },
  {
    id: 'if_coloc',
    label: 'IF 免疫荧光共定位',
    description: '双通道荧光：掩膜 Pearson 相关与 Manders M1/M2 系数',
    stains: null,
    quantifyChannel: 0,
    quantifyLabel: '通道',
    source: 'Manders 1992 / 1993',
  },
];

export function getStainProfile(id: StainProfileId): StainProfile {
  return STAIN_PROFILES.find((profile) => profile.id === id) ?? STAIN_PROFILES[0];
}

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
    coloc: { ...DEFAULT_COLOC },
    stainOverrides: {},
    rois: [],
    samples: [],
  };
}
