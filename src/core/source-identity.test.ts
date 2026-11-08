import { describe, expect, it } from 'vitest';
import { sourceContentId } from './source-identity';

describe('source content identity', () => {
  it('recognizes renamed copies without confusing a same-name replacement', async () => {
    const first = new File(['raw bytes'], 'image.png');
    const renamed = new File(['raw bytes'], 'renamed.png');
    const replacement = new File(['different bytes'], 'image.png');
    expect(await sourceContentId(first)).toBe(await sourceContentId(renamed));
    expect(await sourceContentId(first)).not.toBe(await sourceContentId(replacement));
  });
});
