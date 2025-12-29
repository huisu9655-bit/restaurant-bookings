import { PageContainer, ProCard, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Image, Input, Pagination, Select, Space, Typography, message } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { request } from '@umijs/max';
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n';

type StoreOption = { id: string; name: string };

type Influencer = {
  id: string;
  displayName: string;
  handle?: string;
  avatarData?: string;
  contactMethod?: string;
  contactInfo?: string;
};

type Booking = {
  id: string;
  storeName: string;
  storeId?: string;
  influencerId: string;
  creatorName: string;
  handle?: string;
  contactMethod?: string;
  contactInfo?: string;
  visitDate?: string;
  visitWindow?: string;
};

type TrafficLog = {
  id: string;
  influencerName: string;
  storeName?: string;
  postDate?: string;
  videoLink?: string;
  metrics?: {
    views?: number;
    likes?: number;
    comments?: number;
    saves?: number;
    shares?: number;
  };
  capturedAt?: string;
};

type OverviewCache = {
  ts: number;
  stores: StoreOption[];
  influencerMap: Map<string, Influencer>;
  recentBookings: Booking[];
  trafficLogs: TrafficLog[];
};

const OVERVIEW_CACHE_TTL_MS = 60_000;
let overviewCache: OverviewCache | null = null;
let overviewInFlight: Promise<OverviewCache> | null = null;

function toYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDateTime(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}

export default function OverviewPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [trafficLogs, setTrafficLogs] = useState<TrafficLog[]>([]);
  const [influencerMap, setInfluencerMap] = useState<Map<string, Influencer>>(new Map());
  const [trafficStore, setTrafficStore] = useState<string>('ALL');
  const [trafficQuery, setTrafficQuery] = useState<string>('');
  const [trafficPostDateSort, setTrafficPostDateSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [trafficPage, setTrafficPage] = useState(1);
  const [trafficPageSize, setTrafficPageSize] = useState(10);

  useEffect(() => {
    let mounted = true;

    const start = toYMD(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 6);
    const end = toYMD(endDate);

    const apply = (data: OverviewCache) => {
      if (!mounted) return;
      setStores(data.stores);
      setInfluencerMap(data.influencerMap);
      setRecentBookings(data.recentBookings);
      setTrafficLogs(data.trafficLogs);
    };

    const fetchData = async (): Promise<OverviewCache> => {
      if (overviewInFlight) return overviewInFlight;
      overviewInFlight = Promise.all([
        request('/api/stores'),
        request('/api/influencers'),
        request('/api/bookings', { params: { startDate: start, endDate: end } }),
        request('/api/traffic')
      ])
        .then(([storeRes, infRes, bookingRes, trafficRes]) => {
          const storeList = Array.isArray(storeRes?.stores) ? storeRes.stores : [];
          const nextStores = storeList
            .map((s: any) => ({ id: String(s.id || ''), name: String(s.name || '') }))
            .filter(s => s.id);

          const infList = Array.isArray(infRes?.influencers) ? infRes.influencers : [];
          const nextMap = new Map<string, Influencer>();
          for (const it of infList) {
            if (!it?.id) continue;
            nextMap.set(String(it.id), {
              id: String(it.id),
              displayName: String(it.displayName || ''),
              handle: String(it.handle || ''),
              avatarData: String(it.avatarData || ''),
              contactMethod: String(it.contactMethod || ''),
              contactInfo: String(it.contactInfo || '')
            });
          }

          const bookingList = Array.isArray(bookingRes?.records) ? bookingRes.records : [];
          const filtered = bookingList.filter((b: any) => {
            const visitDate = String(b.visitDate || '');
            return visitDate && visitDate >= start && visitDate <= end;
          });
          const nextRecentBookings = filtered.map((b: any) => ({
            id: String(b.id || ''),
            storeName: String(b.storeName || ''),
            storeId: String(b.storeId || ''),
            influencerId: String(b.influencerId || ''),
            creatorName: String(b.creatorName || ''),
            handle: String(b.handle || ''),
            contactMethod: String(b.contactMethod || ''),
            contactInfo: String(b.contactInfo || ''),
            visitDate: String(b.visitDate || ''),
            visitWindow: String(b.visitWindow || '')
          }));

          const logs = Array.isArray(trafficRes?.logs) ? trafficRes.logs : [];
          const nextTrafficLogs = logs.map((t: any) => ({
            id: String(t.id || ''),
            influencerName: String(t.influencerName || ''),
            storeName: String(t.storeName || ''),
            postDate: String(t.postDate || ''),
            videoLink: String(t.videoLink || ''),
            metrics: t.metrics || {},
            capturedAt: String(t.capturedAt || '')
          }));

          const data: OverviewCache = {
            ts: Date.now(),
            stores: nextStores,
            influencerMap: nextMap,
            recentBookings: nextRecentBookings,
            trafficLogs: nextTrafficLogs
          };
          overviewCache = data;
          return data;
        })
        .finally(() => {
          overviewInFlight = null;
        });
      return overviewInFlight;
    };

    const hasCache = !!overviewCache;
    const isFresh = overviewCache ? Date.now() - overviewCache.ts < OVERVIEW_CACHE_TTL_MS : false;

    if (overviewCache) {
      apply(overviewCache);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void (async () => {
      try {
        if (isFresh) {
          // 仍然后台静默刷新一次，避免缓存导致数据长时间不更新
          const fresh = await fetchData();
          apply(fresh);
          return;
        }
        const data = await fetchData();
        apply(data);
      } catch (error: any) {
        if (!mounted) return;
        if (!hasCache) {
          message.error(error?.data?.error || t('overview.loadFailed'));
        } else {
          // 有缓存时静默失败，避免每次切换页面都弹错误
          console.warn('[overview] refresh failed:', error?.data?.error || error?.message || error);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const trafficFiltered = useMemo(() => {
    const q = trafficQuery.trim().toLowerCase();
    const filtered = trafficLogs
      .filter(t => {
        if (trafficStore !== 'ALL' && String(t.storeName || '') !== trafficStore) return false;
        if (q && !String(t.influencerName || '').toLowerCase().includes(q)) return false;
        return true;
      });

    const toPostDateValue = (value?: string) => {
      const text = String(value || '').trim();
      if (!text) return null;
      const ts = Date.parse(text);
      if (Number.isNaN(ts)) return null;
      return ts;
    };

    const byViewsDesc = (a: TrafficLog, b: TrafficLog) =>
      (Number(b.metrics?.views || 0) || 0) - (Number(a.metrics?.views || 0) || 0);

    const byPostDate = (a: TrafficLog, b: TrafficLog, dir: 'asc' | 'desc') => {
      const av = toPostDateValue(a.postDate);
      const bv = toPostDateValue(b.postDate);
      if (av === null && bv === null) return byViewsDesc(a, b);
      if (av === null) return 1;
      if (bv === null) return -1;
      const diff = av - bv;
      if (diff === 0) return byViewsDesc(a, b);
      return dir === 'asc' ? diff : -diff;
    };

    return filtered
      .slice()
      .sort((a, b) => {
        if (trafficPostDateSort === 'asc') return byPostDate(a, b, 'asc');
        if (trafficPostDateSort === 'desc') return byPostDate(a, b, 'desc');
        return byViewsDesc(a, b);
      });
  }, [trafficLogs, trafficQuery, trafficStore, trafficPostDateSort]);

  useEffect(() => {
    setTrafficPage(1);
  }, [trafficStore, trafficQuery, trafficPostDateSort]);

  useEffect(() => {
    const total = trafficFiltered.length;
    const maxPage = Math.max(1, Math.ceil(total / trafficPageSize));
    setTrafficPage(prev => Math.min(prev, maxPage));
  }, [trafficFiltered.length, trafficPageSize]);

  const trafficPaged = useMemo(() => {
    const start = (trafficPage - 1) * trafficPageSize;
    return trafficFiltered.slice(start, start + trafficPageSize);
  }, [trafficFiltered, trafficPage, trafficPageSize]);

  const recentBookingColumns: ProColumns<Booking>[] = [
    {
      title: t('overview.col.influencer'),
      dataIndex: 'creatorName',
      render: (_, record) => {
        const influencer = influencerMap.get(record.influencerId);
        const displayName = influencer?.displayName || record.creatorName || '';
        const handle = influencer?.handle || record.handle || '';
        const avatar = influencer?.avatarData || '';
        return (
          <Space size={10}>
            {avatar ? (
              <Image
                src={avatar}
                width={52}
                height={26}
                style={{ borderRadius: 8, objectFit: 'contain', background: 'rgba(15,23,42,0.04)' }}
                preview={{ src: avatar }}
              />
            ) : null}
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600 }}>{displayName || '-'}</div>
              <div style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>{handle || record.creatorName || ''}</div>
            </div>
          </Space>
        );
      }
    },
    {
      title: t('overview.col.contact'),
      dataIndex: 'contactInfo',
      render: (_, record) => {
        const influencer = influencerMap.get(record.influencerId);
        const method = influencer?.contactMethod || record.contactMethod || '';
        const info = influencer?.contactInfo || record.contactInfo || '';
        return (
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600 }}>{method || '-'}</div>
            <div style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>{info || ''}</div>
          </div>
        );
      }
    },
    { title: t('overview.col.store'), dataIndex: 'storeName', width: 160, ellipsis: true },
    {
      title: t('overview.col.visitTime'),
      dataIndex: 'visitDate',
      render: (_, record) => {
        const visitDate = record.visitDate || '';
        const window = record.visitWindow || '';
        return <span>{[visitDate, window].filter(Boolean).join(' ')}</span>;
      }
    }
  ];

  const trafficColumns: ProColumns<TrafficLog>[] = [
    { title: t('overview.col.influencer'), dataIndex: 'influencerName', width: 180, ellipsis: true },
    { title: t('overview.col.store'), dataIndex: 'storeName', width: 160, ellipsis: true },
    {
      title: t('overview.col.videoLink'),
      dataIndex: 'videoLink',
      width: 110,
      render: (_, record) =>
        record.videoLink ? (
          <a href={record.videoLink} target="_blank" rel="noreferrer">
            {t('common.view')}
          </a>
        ) : (
          '-'
        )
    },
    {
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {t('overview.col.postDate')}
          <button
            type="button"
            onClick={() => {
              setTrafficPostDateSort(prev => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
            }}
            title={
              trafficPostDateSort === 'none'
                ? t('overview.postDateSort.tip.asc')
                : trafficPostDateSort === 'asc'
                  ? t('overview.postDateSort.tip.desc')
                  : t('overview.postDateSort.tip.none')
            }
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: '1px solid rgba(15,23,42,0.14)',
              background: 'rgba(255,255,255,0.9)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              cursor: 'pointer'
            }}
          >
            <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0.8 }}>
              <CaretUpOutlined
                style={{
                  fontSize: 10,
                  color: trafficPostDateSort === 'asc' ? '#1f64ff' : 'rgba(15,23,42,0.35)'
                }}
              />
              <CaretDownOutlined
                style={{
                  fontSize: 10,
                  marginTop: -2,
                  color: trafficPostDateSort === 'desc' ? '#1f64ff' : 'rgba(15,23,42,0.35)'
                }}
              />
            </span>
          </button>
        </span>
      ),
      dataIndex: 'postDate',
      width: 150
    },
    { title: t('overview.col.views'), dataIndex: ['metrics', 'views'], width: 110, valueType: 'digit' },
    { title: t('overview.col.likes'), dataIndex: ['metrics', 'likes'], width: 110, valueType: 'digit' },
    { title: t('overview.col.comments'), dataIndex: ['metrics', 'comments'], width: 110, valueType: 'digit' },
    { title: t('overview.col.saves'), dataIndex: ['metrics', 'saves'], width: 110, valueType: 'digit' },
    { title: t('overview.col.shares'), dataIndex: ['metrics', 'shares'], width: 110, valueType: 'digit' },
    {
      title: t('overview.col.updatedAt'),
      dataIndex: 'capturedAt',
      width: 170,
      render: (_, record) => fmtDateTime(record.capturedAt)
    }
  ];

  return (
    <PageContainer title={t('overview.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ProCard
          loading={loading}
          bordered
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            background: 'rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(10px)'
          }}
          title={
            <div>
              <div style={{ fontWeight: 700 }}>{t('overview.recentTitle')}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('overview.recentSub')}
              </Typography.Text>
            </div>
          }
        >
          <ProTable<Booking>
            rowKey="id"
            search={false}
            options={false}
            columns={recentBookingColumns}
            dataSource={recentBookings.slice(0, 50)}
            pagination={false}
          />
        </ProCard>

        <ProCard
          loading={loading}
          bordered
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            background: 'rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(10px)'
          }}
          title={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t('overview.trafficTitle')}</div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {trafficPostDateSort === 'none'
                    ? t('overview.trafficSub.none')
                    : trafficPostDateSort === 'asc'
                      ? t('overview.trafficSub.asc')
                      : t('overview.trafficSub.desc')}
                </Typography.Text>
              </div>
              <Space size={10} wrap>
                <Select
                  style={{ width: 160 }}
                  value={trafficStore}
                  onChange={value => setTrafficStore(value)}
                  options={[
                    { label: t('overview.filter.allStores'), value: 'ALL' },
                    ...stores.map(s => ({ label: s.name, value: s.name }))
                  ]}
                />
                <Input
                  style={{ width: 240 }}
                  allowClear
                  placeholder={t('overview.filter.searchInfluencer')}
                  value={trafficQuery}
                  onChange={e => setTrafficQuery(e.target.value)}
                />
              </Space>
            </div>
          }
        >
          <ProTable<TrafficLog>
            rowKey="id"
            loading={loading}
            search={false}
            options={false}
            columns={trafficColumns}
            dataSource={trafficPaged}
            scroll={{ x: 1100 }}
          />
          <div className="booking-footer">
            <Space size={10} style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>
              <span>{t('pagination.total', { total: trafficFiltered.length })}</span>
                <Select
                  value={trafficPageSize}
                  style={{ width: 110 }}
                options={[10, 20, 30, 50].map(v => ({ label: t('pagination.perPage', { size: v }), value: v }))}
                  onChange={value => {
                    setTrafficPageSize(value);
                    setTrafficPage(1);
                  }}
                />
            </Space>
            <Pagination
              current={trafficPage}
              pageSize={trafficPageSize}
              total={trafficFiltered.length}
              showQuickJumper
              showSizeChanger={false}
              onChange={p => setTrafficPage(p)}
            />
          </div>
        </ProCard>
      </div>
    </PageContainer>
  );
}
