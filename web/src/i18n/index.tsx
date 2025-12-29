import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/zh-cn';
import { LANG_OPTIONS, LANG_STORAGE_KEY, messages, type Lang } from './messages';

type Params = Record<string, string | number | null | undefined>;

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Params) => string;
  options: typeof LANG_OPTIONS;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLang(value: unknown): Lang {
  const raw = String(value || '').trim();
  if (raw === 'vi' || raw.toLowerCase().startsWith('vi')) return 'vi-VN';
  if (raw === 'zh' || raw.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (raw === 'vi-VN' || raw === 'zh-CN') return raw as Lang;
  return 'zh-CN';
}

function detectDefaultLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored) return normalizeLang(stored);
  } catch {}
  if (typeof navigator !== 'undefined') {
    const nav = (navigator.language || '').trim();
    if (nav) return normalizeLang(nav);
  }
  return 'zh-CN';
}

function format(template: string, params?: Params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, name) => {
    const value = params[name];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectDefaultLang());

  const setLang = (next: Lang) => {
    const fixed = normalizeLang(next);
    setLangState(fixed);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, fixed);
    } catch {}
  };

  useEffect(() => {
    dayjs.locale(lang === 'vi-VN' ? 'vi' : 'zh-cn');
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, params?: Params) => {
      const dict = messages[lang] || messages['zh-CN'];
      const template = dict[key] ?? messages['zh-CN'][key] ?? key;
      return format(template, params);
    };
    return { lang, setLang, t, options: LANG_OPTIONS };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within LangProvider');
  }
  return ctx;
}

