import { defineConfig } from '@umijs/max';

export default defineConfig({
  npmClient: 'npm',
  antd: {},
  request: {},
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/login', component: './Login' },
    { path: '/overview', name: '投放总览', component: './Overview' },
    { path: '/influencers', name: '网红管理', component: './Influencers' },
    { path: '/bookings', name: '预约与流量', component: './Bookings' },
    { path: '/stores', name: '门店管理', component: './Stores' },
    { path: '/users', name: '用户管理', component: './Users' },
    { path: '*', component: './NotFound' }
  ],
  proxy: {
    '/api': {
      target: 'http://localhost:8787',
      changeOrigin: true
    }
  }
});
