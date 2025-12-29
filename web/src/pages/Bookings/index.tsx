import { PageContainer, ProCard } from '@ant-design/pro-components';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import React, { useEffect, useMemo, useState } from 'react';
import { request } from '@umijs/max';
import dayjs from 'dayjs';
import { useI18n } from '../../i18n';

type StoreOption = { id: string; name: string };
type InfluencerOption = { id: string; displayName: string; handle?: string };

type Booking = {
  id: string;
  storeId: string;
  storeName: string;
  influencerId: string;
  creatorName: string;
  handle?: string;
  contactMethod?: string;
  contactInfo?: string;
  visitDate?: string;
  visitWindow?: string;
  sourceType?: string;
  serviceDetail?: string;
  videoRights?: string;
  postDate?: string;
  videoLink?: string;
  budgetMillionVND?: number;
  notes?: string;
  createdAt?: string;
};

type TrafficLog = {
  id: string;
  bookingId?: string;
  postDate?: string;
  videoLink?: string;
  metrics?: { views?: number; likes?: number; comments?: number; saves?: number; shares?: number };
  note?: string;
  capturedAt?: string;
};

function fmtYMD(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function normalizeDigit(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function BookingsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trafficLogs, setTrafficLogs] = useState<TrafficLog[]>([]);

  const [filterQuery, setFilterQuery] = useState('');
  const [filterStore, setFilterStore] = useState<string>('ALL');
  const [filterVisitDate, setFilterVisitDate] = useState<string>('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingEditing, setBookingEditing] = useState<Booking | null>(null);
  const [bookingForm] = Form.useForm();

  const [trafficOpen, setTrafficOpen] = useState(false);
  const [trafficSaving, setTrafficSaving] = useState(false);
  const [trafficBooking, setTrafficBooking] = useState<Booking | null>(null);
  const [trafficLog, setTrafficLog] = useState<TrafficLog | null>(null);
  const [trafficForm] = Form.useForm();

  const [influencers, setInfluencers] = useState<InfluencerOption[]>([]);
  const [influencersLoading, setInfluencersLoading] = useState(false);

  const trafficByBookingId = useMemo(() => {
    const map = new Map<string, TrafficLog>();
    for (const log of trafficLogs) {
      const bookingId = String(log.bookingId || '');
      if (!bookingId) continue;
      if (map.has(bookingId)) continue;
      map.set(bookingId, log);
    }
    return map;
  }, [trafficLogs]);

  const pagedBookings = useMemo(() => {
    const start = (page - 1) * pageSize;
    return bookings.slice(start, start + pageSize);
  }, [bookings, page, pageSize]);

  async function loadStores() {
    try {
      const res = await request('/api/stores');
      const list = Array.isArray(res?.stores) ? (res.stores as StoreOption[]) : [];
      setStores(list);
    } catch {
      setStores([]);
    }
  }

  async function loadBookings() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      const q = filterQuery.trim();
      if (q) params.q = q;
      if (filterStore !== 'ALL') params.store = filterStore;
      if (filterVisitDate) {
        params.startDate = filterVisitDate;
        params.endDate = filterVisitDate;
      }
      const res = await request('/api/bookings', { params });
      const list = Array.isArray(res?.records) ? (res.records as Booking[]) : [];
      setBookings(list);
    } catch (error: any) {
      message.error(error?.data?.error || t('bookings.loadFailed'));
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadTraffic() {
    try {
      const res = await request('/api/traffic');
      const list = Array.isArray(res?.logs) ? (res.logs as TrafficLog[]) : [];
      setTrafficLogs(list);
    } catch {
      setTrafficLogs([]);
    }
  }

  async function ensureInfluencers() {
    if (influencersLoading || influencers.length) return;
    setInfluencersLoading(true);
    try {
      const res = await request('/api/influencers');
      const list = Array.isArray(res?.influencers) ? (res.influencers as any[]) : [];
      setInfluencers(
        list
          .filter(it => it?.id)
          .map(it => ({
            id: String(it.id),
            displayName: String(it.displayName || ''),
            handle: String(it.handle || '')
          }))
      );
    } catch {
      setInfluencers([]);
    } finally {
      setInfluencersLoading(false);
    }
  }

  useEffect(() => {
    void loadStores();
    void loadTraffic();
  }, []);

  useEffect(() => {
    setPage(1);
    void loadBookings();
  }, [filterQuery, filterStore, filterVisitDate]);

  const columns = [
    {
      title: t('bookings.col.influencer'),
      dataIndex: 'creatorName',
      width: 140,
      render: (_: unknown, record: Booking) => record.creatorName || '-'
    },
    { title: t('bookings.col.store'), dataIndex: 'storeName', width: 140, ellipsis: true },
    {
      title: t('bookings.col.type'),
      dataIndex: 'sourceType',
      width: 80,
      render: (_: unknown, record: Booking) => {
        const type = record.sourceType || '预约';
        const label = type === '自来' ? t('bookings.type.walkin') : t('bookings.type.booking');
        return <Tag color={type === '自来' ? 'default' : 'blue'}>{label}</Tag>;
      }
    },
    {
      title: t('bookings.col.visit'),
      dataIndex: 'visitDate',
      width: 420,
      render: (_: unknown, record: Booking) => {
        const date = record.visitDate || '';
        const window = record.visitWindow || '';
        return (
          <div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>
            {[date, window].filter(Boolean).join(' ') || '-'}
          </div>
        );
      }
    },
    {
      title: t('bookings.col.service'),
      dataIndex: 'serviceDetail',
      width: 260,
      render: (_: unknown, record: Booking) => (
        <div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>
          {record.serviceDetail || '-'}
        </div>
      )
    },
    {
      title: t('bookings.col.cost'),
      dataIndex: 'budgetMillionVND',
      width: 90,
      render: (_: unknown, record: Booking) => normalizeDigit(record.budgetMillionVND)
    },
    {
      title: t('bookings.col.traffic'),
      dataIndex: 'id',
      width: 140,
      render: (_: unknown, record: Booking) => {
        const log = trafficByBookingId.get(record.id);
        if (!log) return <span style={{ color: 'rgba(15,23,42,0.55)' }}>{t('bookings.notRecorded')}</span>;
        const views = normalizeDigit(log.metrics?.views);
        const date = fmtYMD(log.capturedAt);
        return (
          <span>
            {views} {t('traffic.views')}
            {date ? ` · ${date}` : ''}
          </span>
        );
      }
    },
    {
      title: t('bookings.col.actions'),
      dataIndex: 'actions',
      width: 220,
      render: (_: unknown, record: Booking) => (
        <Space size={8} wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditBooking(record)}>
            {t('common.edit')}
          </Button>
          <Button size="small" onClick={() => openTraffic(record)}>
            {t('bookings.addTraffic')}
          </Button>
          <Popconfirm
            title={t('bookings.deleteConfirm')}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            onConfirm={() => void removeBooking(record)}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  function openCreateBooking() {
    setBookingEditing(null);
    bookingForm.setFieldsValue({
      storeId: '',
      influencerId: '',
      sourceType: '预约',
      visitDate: null,
      visitWindow: '',
      serviceDetail: '',
      videoRights: '',
      postDate: null,
      videoLink: '',
      budgetMillionVND: 0,
      notes: ''
    });
    void ensureInfluencers();
    setBookingOpen(true);
  }

  function openEditBooking(record: Booking) {
    setBookingEditing(record);
    bookingForm.setFieldsValue({
      storeId: record.storeId || '',
      influencerId: record.influencerId || '',
      sourceType: record.sourceType || '预约',
      visitDate: record.visitDate ? dayjs(record.visitDate) : null,
      visitWindow: record.visitWindow || '',
      serviceDetail: record.serviceDetail || '',
      videoRights: record.videoRights || '',
      postDate: record.postDate ? dayjs(record.postDate) : null,
      videoLink: record.videoLink || '',
      budgetMillionVND: normalizeDigit(record.budgetMillionVND),
      notes: record.notes || ''
    });
    void ensureInfluencers();
    setBookingOpen(true);
  }

  async function saveBooking(values: any) {
    setBookingSaving(true);
    try {
      const payload = {
        storeId: String(values.storeId || ''),
        influencerId: String(values.influencerId || ''),
        sourceType: String(values.sourceType || '预约'),
        visitDate: values.visitDate ? String(values.visitDate.format('YYYY-MM-DD')) : '',
        visitWindow: String(values.visitWindow || ''),
        serviceDetail: String(values.serviceDetail || ''),
        videoRights: String(values.videoRights || ''),
        postDate: values.postDate ? String(values.postDate.format('YYYY-MM-DD')) : '',
        videoLink: String(values.videoLink || ''),
        budgetMillionVND: normalizeDigit(values.budgetMillionVND),
        notes: String(values.notes || '')
      };
      if (bookingEditing) {
        await request(`/api/bookings/${encodeURIComponent(bookingEditing.id)}`, { method: 'PUT', data: payload });
        message.success(t('bookings.saveOk'));
      } else {
        await request('/api/bookings', { method: 'POST', data: payload });
        message.success(t('bookings.createOk'));
        setPage(1);
      }
      setBookingOpen(false);
      await loadBookings();
      await loadTraffic();
    } catch (error: any) {
      message.error(error?.data?.error || t('bookings.saveFailed'));
    } finally {
      setBookingSaving(false);
    }
  }

  async function removeBooking(record: Booking) {
    try {
      await request(`/api/bookings/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      message.success(t('bookings.deleteOk'));
      await loadBookings();
      await loadTraffic();
      const maxPage = Math.max(1, Math.ceil((bookings.length - 1) / pageSize));
      if (page > maxPage) setPage(maxPage);
    } catch (error: any) {
      message.error(error?.data?.error || t('bookings.deleteFailed'));
    }
  }

  function openTraffic(record: Booking) {
    const log = trafficByBookingId.get(record.id) || null;
    setTrafficBooking(record);
    setTrafficLog(log);
    trafficForm.setFieldsValue({
      postDate: log?.postDate ? dayjs(log.postDate) : record.postDate ? dayjs(record.postDate) : null,
      videoLink: log?.videoLink || record.videoLink || '',
      views: normalizeDigit(log?.metrics?.views),
      likes: normalizeDigit(log?.metrics?.likes),
      comments: normalizeDigit(log?.metrics?.comments),
      saves: normalizeDigit(log?.metrics?.saves),
      shares: normalizeDigit(log?.metrics?.shares),
      note: log?.note || ''
    });
    setTrafficOpen(true);
  }

  async function saveTraffic(values: any) {
    if (!trafficBooking) return;
    setTrafficSaving(true);
    try {
      const payload = {
        bookingId: trafficBooking.id,
        postDate: values.postDate ? String(values.postDate.format('YYYY-MM-DD')) : '',
        videoLink: String(values.videoLink || ''),
        views: normalizeDigit(values.views),
        likes: normalizeDigit(values.likes),
        comments: normalizeDigit(values.comments),
        saves: normalizeDigit(values.saves),
        shares: normalizeDigit(values.shares),
        note: String(values.note || '')
      };
      if (trafficLog?.id) {
        await request(`/api/traffic/${encodeURIComponent(trafficLog.id)}`, { method: 'PUT', data: payload });
        message.success(t('traffic.saveOk'));
      } else {
        await request('/api/traffic', { method: 'POST', data: payload });
        message.success(t('traffic.saveOk'));
      }
      setTrafficOpen(false);
      await loadTraffic();
      await loadBookings();
    } catch (error: any) {
      message.error(error?.data?.error || t('traffic.saveFailed'));
    } finally {
      setTrafficSaving(false);
    }
  }

  async function autoFetchTraffic() {
    const videoLink = String(trafficForm.getFieldValue('videoLink') || '').trim();
    if (!videoLink) {
      message.warning(t('traffic.needVideoLink'));
      return;
    }
    try {
      const res = await request('/api/traffic/fetch', { method: 'POST', data: { videoLink } });
      const data = res?.data || {};
      const metrics = data?.metrics || {};
      if (metrics) {
        trafficForm.setFieldsValue({
          views: normalizeDigit(metrics.views),
          likes: normalizeDigit(metrics.likes),
          comments: normalizeDigit(metrics.comments),
          saves: normalizeDigit(metrics.saves),
          shares: normalizeDigit(metrics.shares)
        });
      }
      const postDate = String(data.captionDate || data.postDate || '').trim();
      if (postDate) {
        trafficForm.setFieldsValue({ postDate: dayjs(postDate) });
      }
      message.success(t('traffic.fetchOk'));
    } catch (error: any) {
      message.error(error?.data?.error || t('traffic.fetchFailed'));
    }
  }

  return (
    <PageContainer title={t('bookings.title')}>
      <ProCard
        bordered
        className="glass-card-shell"
        bodyStyle={{ padding: 16 }}
        title={
          <div>
            <div style={{ fontWeight: 700 }}>{t('bookings.listTitle')}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('bookings.listSub')}
            </Typography.Text>
          </div>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateBooking}>
            {t('bookings.addBooking')}
          </Button>
        }
      >
        <div className="booking-filters" style={{ marginBottom: 12 }}>
          <Input
            placeholder={t('bookings.filters.influencer')}
            allowClear
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
          />
          <Select
            value={filterStore}
            onChange={value => setFilterStore(value)}
            options={[
              { label: t('overview.filter.allStores'), value: 'ALL' },
              ...stores.map(s => ({ label: s.name, value: s.id }))
            ]}
          />
          <DatePicker
            allowClear
            value={filterVisitDate ? dayjs(filterVisitDate) : null}
            onChange={d => setFilterVisitDate(d ? d.format('YYYY-MM-DD') : '')}
            placeholder={t('bookings.filters.date')}
            style={{ width: '100%' }}
          />
        </div>

        <Table<Booking>
          rowKey="id"
          loading={loading}
          className="booking-table"
          tableLayout="fixed"
          columns={columns as any}
          dataSource={pagedBookings}
          pagination={false}
        />

        <div className="booking-footer">
          <Space size={10} style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>
            <span>{t('pagination.total', { total: bookings.length })}</span>
            <Select
              value={pageSize}
              style={{ width: 110 }}
              options={[10, 20, 30, 50].map(v => ({ label: t('pagination.perPage', { size: v }), value: v }))}
              onChange={value => {
                setPageSize(value);
                setPage(1);
              }}
            />
          </Space>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={bookings.length}
            showQuickJumper
            onChange={p => setPage(p)}
          />
        </div>
      </ProCard>

      <Modal
        open={bookingOpen}
        closable={false}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>
              {bookingEditing ? t('bookings.editBooking') : t('bookings.addBooking')}
            </span>
            <Button onClick={() => setBookingOpen(false)}>{t('common.close')}</Button>
          </div>
        }
        onCancel={() => setBookingOpen(false)}
        footer={null}
        destroyOnClose
        width={980}
        styles={{ body: { maxHeight: '76vh', overflowY: 'auto', paddingTop: 0 } }}
      >
        <Form
          form={bookingForm}
          layout="vertical"
          onFinish={values => void saveBooking(values)}
        >
          <div className="booking-edit-grid-2">
            <Form.Item
              name="storeId"
              label={t('bookings.form.store')}
              rules={[{ required: true, message: t('bookings.form.required') }]}
            >
              <Select
                size="large"
                placeholder={t('bookings.form.store')}
                options={stores.map(s => ({ label: s.name, value: s.id }))}
              />
            </Form.Item>
            <Form.Item
              name="influencerId"
              label={t('bookings.form.influencer')}
              rules={[{ required: true, message: t('bookings.form.required') }]}
            >
              <Select
                size="large"
                showSearch
                loading={influencersLoading}
                placeholder={t('bookings.filters.influencer')}
                optionFilterProp="label"
                options={influencers.map(it => ({
                  value: it.id,
                  label: it.handle ? `${it.displayName} @${it.handle}` : it.displayName
                }))}
                notFoundContent={t('bookings.influencerNotFound')}
              />
              <div className="koc-edit-help">{t('bookings.form.required')}</div>
            </Form.Item>

          </div>

          <div className="booking-edit-grid-3">
            <Form.Item name="sourceType" label={t('bookings.form.type')}>
              <Select
                size="large"
                options={[
                  { label: t('bookings.type.booking'), value: '预约' },
                  { label: t('bookings.type.walkin'), value: '自来' }
                ]}
              />
            </Form.Item>
            <Form.Item
              name="visitDate"
              label={t('bookings.form.visitDate')}
              rules={[{ required: true, message: t('bookings.form.required') }]}
            >
              <DatePicker style={{ width: '100%' }} size="large" placeholder={t('bookings.filters.date')} />
            </Form.Item>
            <Form.Item name="visitWindow" label={t('bookings.form.visitWindow')}>
              <Input size="large" placeholder={t('bookings.form.visitWindow')} />
            </Form.Item>
          </div>

          <Form.Item name="serviceDetail" label={t('bookings.form.service')} className="booking-edit-full">
            <Input.TextArea rows={6} placeholder="" />
          </Form.Item>

          <div className="booking-edit-grid-3">
            <Form.Item name="videoRights" label={t('bookings.form.scriptReq')}>
              <Input size="large" />
            </Form.Item>
            <Form.Item name="budgetMillionVND" label={t('bookings.form.cost')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
            <Form.Item name="postDate" label={t('bookings.form.expectedPostDate')}>
              <DatePicker style={{ width: '100%' }} size="large" placeholder={t('bookings.filters.date')} />
            </Form.Item>
          </div>

          <Form.Item name="notes" label={t('bookings.form.notes')} className="booking-edit-full">
            <Input.TextArea rows={5} />
          </Form.Item>

          <div className="booking-edit-submit">
            <Button type="primary" htmlType="submit" loading={bookingSaving} block size="large">
              {bookingEditing ? t('common.save') : t('common.submit')}
            </Button>
            <Button onClick={() => setBookingOpen(false)} style={{ marginTop: 10 }} block>
              {t('common.cancel')}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        open={trafficOpen}
        closable={false}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>
              {t('traffic.modalTitle')}
              {trafficBooking ? ` - ${trafficBooking.creatorName}` : ''}
            </span>
            <Button onClick={() => setTrafficOpen(false)}>{t('common.close')}</Button>
          </div>
        }
        onCancel={() => setTrafficOpen(false)}
        footer={null}
        destroyOnClose
        width={980}
        styles={{ body: { maxHeight: '76vh', overflowY: 'auto', paddingTop: 0 } }}
      >
        <Form
          form={trafficForm}
          layout="vertical"
          onFinish={values => void saveTraffic(values)}
        >
          <Form.Item
            name="videoLink"
            label={t('traffic.videoLink')}
            rules={[{ required: true, message: t('bookings.form.required') }]}
          >
            <Input size="large" placeholder="https://www.tiktok.com/..." />
          </Form.Item>
          <Form.Item name="postDate" label={t('traffic.postDate')}>
            <DatePicker style={{ width: '100%' }} size="large" placeholder={t('bookings.filters.date')} />
          </Form.Item>

          <div className="booking-edit-grid-3 booking-traffic-metrics" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
            <Form.Item name="views" label={t('traffic.views')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
            <Form.Item name="likes" label={t('traffic.likes')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
            <Form.Item name="comments" label={t('traffic.comments')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
            <Form.Item name="saves" label={t('traffic.saves')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
            <Form.Item name="shares" label={t('traffic.shares')}>
              <InputNumber min={0} style={{ width: '100%' }} size="large" />
            </Form.Item>
          </div>

          <Form.Item name="note" label={t('traffic.note')} className="booking-edit-full">
            <Input.TextArea rows={6} />
          </Form.Item>

          <div className="booking-edit-submit">
            <Button type="primary" htmlType="submit" loading={trafficSaving} block size="large">
              {trafficLog?.id ? t('common.save') : t('common.submit')}
            </Button>
          </div>
        </Form>
      </Modal>
    </PageContainer>
  );
}
