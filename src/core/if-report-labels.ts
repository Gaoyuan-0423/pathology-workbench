import type { IfMetricKey } from './if-statistics.ts';

/** Display names only; do not translate user-defined identities. */
export const IF_METRIC_LABELS: Record<IfMetricKey, string> = {
  pearsonAll: '全像素 Pearson',
  pearsonMasked: '掩膜 Pearson',
  mandersM1: 'Manders M1',
  mandersM2: 'Manders M2',
};
