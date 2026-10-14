/** 指标中文名（api.ts 与 export.ts 共用，避免 api 依赖 xlsx） */
import type { MetricKey } from './types.ts';

export const METRIC_LABELS: Record<MetricKey, string> = {
  positiveFraction: '阳性面积',
  labelingIndex: '标注指数',
  integratedOpticalDensity: 'IOD',
  meanOpticalDensity: '平均 OD',
  densityPerMm2: '密度 (个/mm²)',
};

export type { MetricKey };
