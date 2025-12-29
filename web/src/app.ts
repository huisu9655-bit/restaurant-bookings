import type { RequestConfig } from '@umijs/max';
import { history } from '@umijs/max';
import React from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import viVN from 'antd/locale/vi_VN';
import { LangProvider, useI18n } from './i18n';
import './global.css';

const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

export function onRouteChange({ location }: { location: Location }) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  if (!token && location.pathname !== '/login') {
    history.push('/login');
  }
}

function AntdLocaleWrapper({ children }: { children: React.ReactNode }) {
  const { lang } = useI18n();
  const locale = lang === 'vi-VN' ? viVN : zhCN;
  return React.createElement(ConfigProvider, { locale }, children as any);
}

export function rootContainer(container: React.ReactNode) {
  return React.createElement(LangProvider, null, React.createElement(AntdLocaleWrapper, null, container as any));
}

export const request: RequestConfig = {
  timeout: 20000,
  requestInterceptors: [
    (url, options) => {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      const headers = { ...(options.headers || {}) } as Record<string, string>;
      if (token) headers.Authorization = `Bearer ${token}`;
      return { url, options: { ...options, headers } };
    }
  ],
  responseInterceptors: [
    async response => {
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (history.location.pathname !== '/login') {
          history.push('/login');
        }
      }
      return response;
    }
  ],
  errorConfig: {
    errorHandler: error => {
      const status = error?.response?.status ?? error?.data?.status ?? error?.status;
      if (status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        if (history.location.pathname !== '/login') {
          history.push('/login');
        }
      }
      throw error;
    }
  }
};
