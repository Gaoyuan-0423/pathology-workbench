import type { StainProfileId } from '../core/types.ts';

export type AnalysisScene = 'ihc' | 'stain' | 'if';

export function sceneForProfile(profileId: StainProfileId): AnalysisScene {
  if (profileId === 'if_coloc') return 'if';
  if (profileId === 'h_eosin' || profileId === 'masson') return 'stain';
  return 'ihc';
}
