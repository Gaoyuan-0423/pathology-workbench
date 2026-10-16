import { useSyncExternalStore } from 'react';
import { messages, templates } from './i18n/messages.ts';

export type Language = 'zh' | 'en';
export const LANGUAGE_KEY = 'wisplab.lang';
export function resolveLanguage(search: string, stored: string | null): Language {
  const requested = new URLSearchParams(search).get('lang');
  return requested === 'zh' || requested === 'en' ? requested : stored === 'en' ? 'en' : 'zh';
}
function readLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage may be disabled. */ }
  const selected = resolveLanguage(window.location.search, stored);
  try { localStorage.setItem(LANGUAGE_KEY, selected); } catch { /* Language still works in memory. */ }
  return selected;
}
let language = readLanguage();
const listeners = new Set<() => void>();
export function getLanguage(): Language { return language; }
function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'Pathology Workbench' : 'Pathology Workbench · 病理工作台';
}
updateDocument();
export function setLanguage(next: Language) {
  language = next;
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Nonpersistent browser mode. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(window.history.state, '', url);
  }
  updateDocument();
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, () => 'zh' as Language);
}
export function withLanguage(href: string): string {
  const base = typeof window === 'undefined' ? 'https://pathology.wisplab.top/' : window.location.href;
  const url = new URL(href, base);
  url.searchParams.set('lang', language);
  return url.href;
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compiledTemplates = templates.map(([zh, en]) => ({
  zh, en, regex: new RegExp('^' + zh.split(/\{\d+\}/).map(escape).join('([\\s\\S]*?)') + '$'),
}));
/** Translate only explicit UI messages, never arbitrary user names or file content. */
export function t(source: string, selected: Language = language): string {
  if (selected === 'zh') return source;
  const normalized = source.replace(/\s+/g, ' ').trim();
  if (Object.hasOwn(messages, normalized)) return (source.match(/^\s*/)?.[0] ?? '') + messages[normalized] + (source.match(/\s*$/)?.[0] ?? '');
  for (const { regex, en } of compiledTemplates) {
    const match = regex.exec(source);
    if (match) return en.replace(/\{(\d+)\}/g, (_, index: string) => match[Number(index) + 1] ?? '');
  }
  return source;
}

/** Translate known error bodies while retaining opaque filenames and technical details. */
export function tError(message: string): string {
  const aiPrefix = 'AI 核分割失败，已回落 Otsu：';
  if (message.startsWith(aiPrefix)) return t(aiPrefix + tError(message.slice(aiPrefix.length)));
  const direct = t(message);
  if (direct !== message) return direct;
  for (let i = message.indexOf('：'); i >= 0; i = message.indexOf('：', i + 1)) {
    const translated = t(message.slice(i + 1));
    if (translated !== message.slice(i + 1)) return message.slice(0, i) + ': ' + translated;
  }
  return message;
}
