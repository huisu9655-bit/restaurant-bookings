import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Button, Form, Image, Input, Modal, Space, Spin, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { request } from '@umijs/max';
import { useI18n } from '../../i18n';

type Store = {
  id: string;
  name: string;
  address?: string;
  imageData?: string;
  createdAt?: string;
  updatedAt?: string;
};

export default function StoresPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<Store>();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);

  const initialUploadFiles = useMemo<UploadFile[]>(() => {
    const img = (editing?.imageData || '').trim();
    if (!img) return [];
    return [{ uid: 'store-image', name: 'store.png', status: 'done', url: img }];
  }, [editing?.imageData]);

  useEffect(() => {
    void loadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStores() {
    setLoading(true);
    try {
      const res = await request('/api/stores');
      const list = Array.isArray(res?.stores) ? res.stores : [];
      setStores(list);
    } catch (error: any) {
      message.error(error?.data?.error || t('stores.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(store: Store) {
    setEditing(store);
    form.setFieldsValue({
      id: store.id,
      name: store.name,
      address: store.address || '',
      imageData: store.imageData || ''
    });
    setOpen(true);
  }

  function setImageDataFromFile(file: File) {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        form.setFieldValue('imageData', String(reader.result || ''));
        resolve();
      };
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  async function saveStore() {
    const values = await form.validateFields();
    const payload = {
      name: String(values.name || '').trim(),
      address: String(values.address || '').trim(),
      imageData: String(values.imageData || '')
    };
    if (!payload.name) {
      message.error(t('stores.nameRequired'));
      return;
    }
    try {
      if (editing?.id) {
        await request(`/api/stores/${encodeURIComponent(editing.id)}`, { method: 'PUT', data: payload });
        message.success(t('stores.saveOk'));
      } else {
        await request('/api/stores', { method: 'POST', data: payload });
        message.success(t('stores.createOk'));
      }
      setOpen(false);
      setEditing(null);
      await loadStores();
    } catch (error: any) {
      message.error(error?.data?.error || t('stores.saveFailed'));
    }
  }

  async function removeStore(store: Store) {
    Modal.confirm({
      title: t('stores.deleteConfirmTitle'),
      content: store.name,
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await request(`/api/stores/${encodeURIComponent(store.id)}`, { method: 'DELETE' });
          message.success(t('stores.deleteOk'));
          await loadStores();
        } catch (error: any) {
          message.error(error?.data?.error || t('stores.deleteFailed'));
        }
      }
    });
  }

  return (
    <PageContainer
      title={t('stores.listTitle')}
      subTitle={t('stores.listSub')}
      extra={[
        <Button key="add" type="primary" onClick={() => void openCreate()}>
          {t('stores.add')}
        </Button>
      ]}
    >
      <div className="glass-card-shell store-shell">
        <div className="store-grid">
          {loading ? (
            <div className="store-empty">
              <Spin />
            </div>
          ) : null}
          {stores.map(store => (
            <div key={store.id} className="store-card">
              <div className="store-cover">
                {store.imageData ? (
                  <Image src={store.imageData} alt={store.name} preview={{ mask: t('common.view') }} />
                ) : (
                  <div className="store-cover-placeholder">
                    <PlusOutlined />
                  </div>
                )}
              </div>
              <div className="store-meta">
                <div className="store-name">{store.name}</div>
                <div className="store-address">{store.address || '-'}</div>
              </div>
              <div className="store-actions">
                <Button
                  className="store-action-btn"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(store)}
                  aria-label={t('stores.edit')}
                />
                <Button
                  className="store-action-btn store-action-danger"
                  icon={<DeleteOutlined />}
                  onClick={() => void removeStore(store)}
                  aria-label={t('common.delete')}
                />
              </div>
            </div>
          ))}
          {!stores.length && !loading ? <div className="store-empty">{t('stores.empty')}</div> : null}
        </div>
      </div>

      <Modal
        title={editing ? t('stores.edit') : t('stores.add')}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={() => void saveStore()}
        okText={editing ? t('common.save') : t('common.submit')}
        cancelText={t('common.cancel')}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ name: '', address: '', imageData: '' }}>
          <Form.Item
            name="name"
            label={t('stores.name')}
            rules={[{ required: true, message: t('stores.nameRequired') }]}
          >
            <Input placeholder={t('stores.name')} />
          </Form.Item>
          <Form.Item name="address" label={t('stores.address')}>
            <Input placeholder={t('stores.address')} />
          </Form.Item>

          <Form.Item name="imageData" label={t('stores.image')}>
            <Upload
              accept="image/*"
              maxCount={1}
              listType="picture-card"
              defaultFileList={initialUploadFiles}
              beforeUpload={async file => {
                try {
                  await setImageDataFromFile(file);
                } catch (error: any) {
                  message.error(error?.message || '读取图片失败');
                }
                return false;
              }}
              onRemove={() => {
                form.setFieldValue('imageData', '');
                return true;
              }}
            >
              <Space direction="vertical" size={0} align="center" style={{ padding: 6 }}>
                <PlusOutlined />
                <span style={{ fontSize: 12, color: 'rgba(15,23,42,0.7)' }}>{t('stores.upload')}</span>
              </Space>
            </Upload>
            <div className="store-upload-hint">{t('stores.uploadHint')}</div>
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
