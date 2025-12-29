import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Button, Form, Input, Modal, Space, Table, message } from 'antd';
import React, { useEffect, useState } from 'react';
import { request } from '@umijs/max';
import { useI18n } from '../../i18n';

type User = {
  id: string;
  username: string;
  role?: string;
};

export default function UsersPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetForm] = Form.useForm();

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await request('/api/users');
      const list = Array.isArray(res?.users) ? (res.users as User[]) : [];
      setUsers(list);
    } catch (error: any) {
      message.error(error?.data?.error || t('users.loadFailed'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function openCreate() {
    createForm.resetFields();
    setCreateOpen(true);
  }

  async function submitCreate() {
    const values = await createForm.validateFields();
    const username = String(values.username || '').trim();
    const password = String(values.password || '').trim();
    if (!username || !password) return;
    setCreating(true);
    try {
      await request('/api/users', { method: 'POST', data: { username, password } });
      message.success(t('users.addOk'));
      setCreateOpen(false);
      await loadUsers();
    } catch (error: any) {
      message.error(error?.data?.error || t('users.addFailed'));
    } finally {
      setCreating(false);
    }
  }

  function openReset(user: User) {
    setResetUser(user);
    resetForm.resetFields();
    setResetOpen(true);
  }

  async function submitReset() {
    if (!resetUser?.id) return;
    const values = await resetForm.validateFields();
    const password = String(values.password || '').trim();
    if (!password) return;
    setResetting(true);
    try {
      await request(`/api/users/${encodeURIComponent(resetUser.id)}`, { method: 'PUT', data: { password } });
      message.success(t('users.resetOk'));
      setResetOpen(false);
    } catch (error: any) {
      message.error(error?.data?.error || t('users.resetFailed'));
    } finally {
      setResetting(false);
    }
  }

  return (
    <PageContainer
      title={t('users.title')}
      extra={[
        <Space key="actions" size={10}>
          <Button icon={<ReloadOutlined />} onClick={() => void loadUsers()}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('users.add')}
          </Button>
        </Space>
      ]}
    >
      <div className="glass-card-shell user-shell">
        <Table<User>
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={users}
          columns={[
            {
              title: t('users.account'),
              dataIndex: 'username',
              render: (value: unknown) => <span style={{ fontWeight: 600 }}>{String(value || '-')}</span>
            },
            { title: t('users.role'), dataIndex: 'role', width: 160, render: (value: unknown) => String(value || 'admin') },
            {
              title: t('users.action'),
              dataIndex: 'id',
              width: 180,
              render: (_: unknown, record: User) => (
                <Button className="user-reset-btn" onClick={() => openReset(record)}>
                  {t('users.resetPwd')}
                </Button>
              )
            }
          ]}
        />
      </div>

      <Modal
        title={t('users.addTitle')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
        confirmLoading={creating}
        destroyOnClose
        width={520}
      >
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Form.Item name="username" label={t('users.account')} rules={[{ required: true, message: t('auth.usernamePlaceholder') }]}>
            <Input placeholder={t('auth.usernamePlaceholder')} autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label={t('auth.password')} rules={[{ required: true, message: t('auth.passwordPlaceholder') }]}>
            <Input.Password placeholder={t('auth.passwordPlaceholder')} autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('users.resetTitle')}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={() => void submitReset()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={resetting}
        destroyOnClose
        width={520}
      >
        <div style={{ color: 'rgba(15,23,42,0.6)', fontSize: 12, marginBottom: 10 }}>
          {t('users.account')}：<span style={{ fontWeight: 600, color: 'rgba(15,23,42,0.9)' }}>{resetUser?.username || '-'}</span>
        </div>
        <Form form={resetForm} layout="vertical" requiredMark={false}>
          <Form.Item name="password" label={t('users.newPwd')} rules={[{ required: true, message: t('users.newPwd') }]}>
            <Input.Password placeholder={t('users.newPwd')} autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
