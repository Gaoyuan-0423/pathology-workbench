import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, resolveLanguage, setLanguage, t, tError, withLanguage } from './i18n.ts';
import { messages, templates } from './i18n/messages.ts';

afterEach(() => setLanguage('zh'));
describe('language selection and explicit messages', () => {
  it('prefers a valid URL language, then storage, then Chinese', () => {
    expect(resolveLanguage('?lang=en&mode=single', 'zh')).toBe('en');
    expect(resolveLanguage('?lang=zh', 'en')).toBe('zh');
    expect(resolveLanguage('?lang=other', 'en')).toBe('en');
    expect(resolveLanguage('', 'bad')).toBe('zh');
  });
  it('preserves unrelated navigation parameters and the hash', () => {
    setLanguage('en');
    expect(withLanguage('https://wb.wisplab.top/?mode=single#results')).toBe('https://wb.wisplab.top/?mode=single&lang=en#results');
    expect(getLanguage()).toBe('en');
  });
  it('translates every explicit message and retains surrounding spaces', () => {
    setLanguage('en');
    for (const [zh, en] of Object.entries(messages)) expect(t(zh), zh).toBe(en);
    expect(t(' 阈值 ')).toBe(' Threshold ');
  });
  it('translates every template without altering opaque filenames or names', () => {
    setLanguage('en');
    for (const [zh, en] of templates) {
      const fill = (text: string) => text.replace(/\{(\d+)\}/g, (_, n: string) => `用户-${n}.png`);
      expect(t(fill(zh)), zh).toBe(fill(en));
    }
    expect(t('正在解码 对照组.png…')).toBe('Decoding 对照组.png…');
    expect(t('未知用户标签')).toBe('未知用户标签');
  });
  it('translates nested known failures without modifying the filename', () => {
    setLanguage('en');
    expect(tError('对照组：test.png：无法解码该图像文件，请使用 PNG/JPEG/TIFF。'))
      .toBe('对照组：test.png: Unable to decode this image. Use PNG, JPEG or TIFF.');
    expect(tError('AI 核分割失败，已回落 Otsu：AI 模型未加载'))
      .toBe('AI segmentation failed; using Otsu instead: AI model not loaded');
  });
});
