import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { GlobalOutlined } from '@ant-design/icons';
import { Button, Form, Input, Select, Space, message } from 'antd';
import React, { useState } from 'react';
import { history, request } from '@umijs/max';
import { useI18n } from '../../i18n';

const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

export default function LoginPage() {
  const [submitting, setSubmitting] = useState(false);
  const { t, lang, setLang, options } = useI18n();

  async function handleLogin(values: { username?: string; password?: string }) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await request('/api/login', { method: 'POST', data: values });
      if (!res?.token) {
        message.error(t('auth.loginNoToken'));
        return;
      }
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(
        USER_KEY,
        JSON.stringify({
          id: String(res?.user?.id || ''),
          username: String(res?.user?.username || values.username || ''),
          role: String(res?.user?.role || '')
        })
      );
      history.push('/overview');
    } catch (error: any) {
      message.error(error?.data?.error || t('auth.loginFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-left">
          <div className="login-left-text">
            <div className="login-left-title">{t('auth.greetingTitle')}</div>
            <div className="login-left-sub">{t('auth.greetingSub')}</div>
          </div>
        </div>
        <div className="login-right">
          <div className="login-topbar">
            <Space size={10} align="center">
              <Select
                size="small"
                value={lang}
                onChange={value => setLang(value)}
                options={options.map(opt => ({ value: opt.value, label: opt.label }))}
                suffixIcon={<GlobalOutlined style={{ color: 'rgba(15,23,42,0.55)' }} />}
                style={{ width: 118 }}
              />
            </Space>
          </div>
          <div className="login-title">{t('auth.loginTitle')}</div>
          <div className="login-subtitle">{t('auth.loginSubtitle')}</div>

          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={values => void handleLogin(values)}
            initialValues={{ username: '', password: '' }}
          >
            <Form.Item
              name="username"
              label={t('auth.username')}
              rules={[{ required: true, message: t('auth.usernamePlaceholder') }]}
            >
              <Input
                size="large"
                prefix={<UserOutlined />}
                placeholder={t('auth.usernamePlaceholder')}
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={t('auth.password')}
              rules={[{ required: true, message: t('auth.passwordPlaceholder') }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button
              className="login-submit"
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={submitting}
            >
              {t('auth.login')}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
