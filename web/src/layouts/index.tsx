import {
  CalendarOutlined,
  DashboardOutlined,
  DownOutlined,
  GlobalOutlined,
  LogoutOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined
} from '@ant-design/icons';
import { ProLayout } from '@ant-design/pro-components';
import { Avatar, Button, Dropdown, Select, Space } from 'antd';
import React from 'react';
import { Link, Outlet, history, useLocation, request } from '@umijs/max';
import { useI18n } from '../i18n';

const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

export default function RootLayout() {
  const location = useLocation();
  const { t, lang, setLang, options } = useI18n();

  if (location.pathname === '/login') {
    return <Outlet />;
  }

  const token = localStorage.getItem(TOKEN_KEY) || '';
  if (!token) {
    history.replace('/login');
    return <Outlet />;
  }

  const parseUser = (raw: string | null) => {
    const text = String(raw || '').trim();
    if (!text) return { username: 'admin', role: 'admin' };
    if (text.startsWith('{')) {
      try {
        const obj = JSON.parse(text);
        const username = String(obj?.username || obj?.user?.username || 'admin').trim() || 'admin';
        const role = String(obj?.role || obj?.user?.role || 'admin').trim() || 'admin';
        return { username, role };
      } catch {
        return { username: 'admin', role: 'admin' };
      }
    }
    return { username: text, role: 'admin' };
  };

  const user = parseUser(localStorage.getItem(USER_KEY));

  const menuRoutes = [
    { path: '/overview', name: t('menu.overview'), icon: <DashboardOutlined /> },
    { path: '/bookings', name: t('menu.bookings'), icon: <CalendarOutlined /> },
    { path: '/influencers', name: t('menu.influencers'), icon: <TeamOutlined /> },
    { path: '/stores', name: t('menu.stores'), icon: <ShopOutlined /> },
    { path: '/users', name: t('menu.users'), icon: <UserOutlined /> }
  ];

  async function logout() {
    try {
      await request('/api/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    history.push('/login');
  }

  return (
    <ProLayout
      className="app-shell"
      title={t('app.title')}
      route={{ routes: menuRoutes }}
      location={{ pathname: location.pathname }}
      fixSiderbar
      layout="mix"
      navTheme="light"
      siderWidth={220}
      contentStyle={{ paddingInline: 0, paddingBlock: 16 }}
      menuHeaderRender={false}
      menuItemRender={(item, dom) => {
        if (!item.path) return dom;
        return <Link to={item.path}>{dom}</Link>;
      }}
      rightContentRender={() => (
        <Space size={10} align="center" style={{ paddingRight: 8 }}>
          <Select
            size="small"
            value={lang}
            onChange={value => setLang(value)}
            options={options.map(opt => ({ value: opt.value, label: opt.label }))}
            suffixIcon={<GlobalOutlined style={{ color: 'rgba(255,255,255,0.82)' }} />}
            style={{ width: 118 }}
          />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'user',
                  label: `${user.username}${user.role ? `（${t('auth.role')}:${user.role}）` : ''}`,
                  disabled: true
                },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: t('auth.logout') }
              ],
              onClick: info => {
                if (info.key === 'logout') void logout();
              }
            }}
          >
            <Space style={{ cursor: 'pointer', userSelect: 'none' }}>
              <Avatar size="small" style={{ background: '#1f64ff' }}>
                {String(user.username || 'A').slice(0, 1).toUpperCase()}
              </Avatar>
              <span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 500 }}>
                {user.username}
                <DownOutlined style={{ fontSize: 10, marginLeft: 6, color: 'rgba(255,255,255,0.65)' }} />
              </span>
            </Space>
          </Dropdown>
        </Space>
      )}
    >
      <Outlet />
    </ProLayout>
  );
}
