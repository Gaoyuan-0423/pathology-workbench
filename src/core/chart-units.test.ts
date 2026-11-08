import { describe, expect, it } from 'vitest';
import { compareGroups } from './analysis/statistics';
import { groupBarChartSvg } from './chart';

describe('unit-based group chart', () => {
  it('keeps empty groups visible without manufacturing a zero measurement', () => {
    const report = compareGroups([{ name: 'Control', values: [1, 2, 3] }, { name: 'Missing', values: [] }], { designStatus: 'confirmed', controlGroup: 'Control' });
    const svg = groupBarChartSvg(report, { title: 'Units', yLabel: 'Mean field value' });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('Missing (nBio=0;');
    expect(svg.match(/<rect /g)).toHaveLength(2); // Background and one actual group bar.
    expect(report.omnibusParametric).toBeNull();
  });
  it('retains a singleton unit mean but never fabricates its SD as zero', () => {
    const report = compareGroups([{ name: 'Control', values: [1, 2] }, { name: 'Single', values: [3] }], { designStatus: 'confirmed', controlGroup: 'Control' });
    const svg = groupBarChartSvg(report, { title: 'Units', yLabel: 'Mean field value' });
    expect(svg).toContain('Single (nBio=1)');
    expect(svg.match(/data-errorbar="sd"/g)).toHaveLength(1);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
  it('uses structured comparison endpoints even when names contain vs', () => {
    const report = compareGroups([{ name: 'Control vs other', values: [1, 2, 3] }, { name: 'A', values: [4, 5, 6] }, { name: 'B', values: [7, 8, 9] }], { designStatus: 'confirmed', controlGroup: 'Control vs other' });
    const svg = groupBarChartSvg(report, { title: 'Units', yLabel: 'Mean field value' });
    expect(svg).not.toMatch(/NaN|Infinity|y="-/);
    expect(report.pairwise.filter((r) => r.method === report.pairwiseSource)).toHaveLength(2);
    // One label for each selected comparison, not both parametric and rank-based alternatives.
    expect((svg.match(/>\*+<\/text>/g) ?? []).length).toBe(2);
  });
});
