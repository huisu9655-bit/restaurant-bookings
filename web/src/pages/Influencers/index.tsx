import {
  PageContainer,
  ProCard
} from '@ant-design/pro-components';
import {
  Button,
  Form,
  Image,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  Upload,
  message
} from 'antd';
import { DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { request } from '@umijs/max';
import { useI18n } from '../../i18n';

type InfluencerFile = {
  id: string;
  influencerId: string;
  kind: 'audit' | 'comment';
  fileName: string;
  createdAt?: string;
};

type Influencer = {
  id: string;
  displayName: string;
  handle?: string;
  contactMethod?: string;
  contactInfo?: string;
  profileLink?: string;
  notes?: string;
  auditFileCount?: number;
  commentFileCount?: number;
  createdAt?: string;
  updatedAt?: string;
  avatarData?: string;
};

type InfluencerListCache = { ts: number; items: Influencer[] };
const INFLUENCERS_CACHE_TTL_MS = 60_000;
let influencersCache: InfluencerListCache | null = null;
let influencersInFlight: Promise<InfluencerListCache> | null = null;
const LAST_CREATED_INFLUENCER_KEY = 'booking_last_influencer_id';

function normalizeDigit(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function tryParseJson(text: string) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function detectDelimiter(firstLine: string) {
  const line = String(firstLine || '');
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) return ',';
  if (line.includes(';')) return ';';
  return ',';
}

function parseDelimitedText(text: string) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { columns: [] as any[], data: [] as any[] };
  const delimiter = detectDelimiter(lines[0]);

  const parseLine = (line: string) => {
    const row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        row.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur.trim());
    return row;
  };

  const rows = lines.map(parseLine);
  const header = rows[0] || [];
  const body = rows.slice(1);
  const columns = header.map((title, idx) => ({
    title: title || `列${idx + 1}`,
    dataIndex: String(idx),
    width: 180,
    ellipsis: true
  }));
  const data = body.slice(0, 500).map((r, i) => {
    const obj: Record<string, any> = { key: i };
    for (let c = 0; c < header.length; c++) obj[String(c)] = r[c] ?? '';
    return obj;
  });
  return { columns, data };
}

function stripAtPrefix(value: unknown) {
  const raw = String(value || '').trim();
  return raw.startsWith('@') ? raw.slice(1).trim() : raw;
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

async function calcAspectRatio(dataUrl: string) {
  const ratio = await new Promise<number>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      if (!w || !h) return resolve(2);
      resolve(w / h);
    };
    img.onerror = () => reject(new Error('读取图片尺寸失败'));
    img.src = dataUrl;
  });
  const clamped = Math.max(1.2, Math.min(3.2, ratio));
  const fixed = Math.round(clamped * 1000) / 1000;
  return `${fixed} / 1`;
}

export default function InfluencersPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Influencer[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(14);

  const lastCreatedIdRef = useRef<string>(
    (() => {
      try {
        return String(localStorage.getItem(LAST_CREATED_INFLUENCER_KEY) || '').trim();
      } catch {
        return '';
      }
    })()
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Influencer | null>(null);
  const [avatarData, setAvatarData] = useState<string>('');
  const [avatarAspect, setAvatarAspect] = useState<string>('2 / 1');
  const [saving, setSaving] = useState(false);
  const [auditFiles, setAuditFiles] = useState<InfluencerFile[]>([]);
  const [commentFiles, setCommentFiles] = useState<InfluencerFile[]>([]);
  const [pendingAuditUploads, setPendingAuditUploads] = useState<File[]>([]);
  const [pendingCommentUploads, setPendingCommentUploads] = useState<File[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [form] = Form.useForm();

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importRows, setImportRows] = useState<number>(0);
  const [importDone, setImportDone] = useState<number>(0);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewKind, setPreviewKind] = useState<'audit' | 'comment'>('audit');
  const [previewInfluencer, setPreviewInfluencer] = useState<Influencer | null>(null);
  const [previewFiles, setPreviewFiles] = useState<InfluencerFile[]>([]);
  const [previewFileId, setPreviewFileId] = useState<string>('');
  const [previewTable, setPreviewTable] = useState<{ columns: any[]; data: any[] } | null>(null);
  const [previewRaw, setPreviewRaw] = useState<string>('');

  async function loadInfluencers(options?: { silent?: boolean }) {
    const silent = !!options?.silent;
    if (!silent) setLoading(true);
    try {
      if (!influencersInFlight) {
        influencersInFlight = request('/api/influencers')
          .then((res: any) => {
            const list = Array.isArray(res?.influencers) ? (res.influencers as Influencer[]) : [];
            const data = { ts: Date.now(), items: list };
            influencersCache = data;
            return data;
          })
          .finally(() => {
            influencersInFlight = null;
          });
      }
      const data = await influencersInFlight;
      setItems(data.items);
      const lastCreatedId = String(lastCreatedIdRef.current || '').trim();
      if (lastCreatedId && !data.items.some(it => it.id === lastCreatedId)) {
        lastCreatedIdRef.current = '';
        try {
          localStorage.removeItem(LAST_CREATED_INFLUENCER_KEY);
        } catch {}
      }
    } catch (error: any) {
      if (!silent) {
        message.error(error?.data?.error || t('influencers.loadFailed'));
        setItems([]);
      } else {
        console.warn('[influencers] refresh failed:', error?.data?.error || error?.message || error);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    const hasCache = !!influencersCache;
    const isFresh = influencersCache ? Date.now() - influencersCache.ts < INFLUENCERS_CACHE_TTL_MS : false;

    if (influencersCache) {
      setItems(influencersCache.items);
      setLoading(false);
    }

    if (!hasCache) {
      void loadInfluencers();
      return;
    }

    if (!isFresh) {
      void loadInfluencers({ silent: true });
      return;
    }

    // 有缓存且仍新鲜：也后台刷新一次，避免数据长期不更新
    void loadInfluencers({ silent: true });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (q) {
      list = list.filter(it => {
        const name = String(it.displayName || '').toLowerCase();
        const handle = String(it.handle || '').toLowerCase();
        return name.includes(q) || handle.includes(q);
      });
    }
    const lastCreatedId = lastCreatedIdRef.current;
    if (lastCreatedId) {
      const idx = list.findIndex(it => it.id === lastCreatedId);
      if (idx >= 0) {
        const picked = list[idx];
        list = [picked, ...list.slice(0, idx), ...list.slice(idx + 1)];
      }
    }
    return list;
  }, [items, query]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openCreate() {
    setEditing(null);
    setAvatarData('');
    setAvatarAspect('2 / 1');
    setAuditFiles([]);
    setCommentFiles([]);
    setPendingAuditUploads([]);
    setPendingCommentUploads([]);
    form.setFieldsValue({
      displayName: '',
      handle: '',
      profileLink: '',
      contactMethod: '',
      contactInfo: '',
      notes: ''
    });
    setEditOpen(true);
  }

  function openEdit(item: Influencer) {
    setEditing(item);
    setAvatarData(item.avatarData || '');
    setAvatarAspect('2 / 1');
    setPendingAuditUploads([]);
    setPendingCommentUploads([]);
    setAuditFiles([]);
    setCommentFiles([]);
    form.setFieldsValue({
      displayName: item.displayName || '',
      handle: stripAtPrefix(item.handle || ''),
      profileLink: item.profileLink || '',
      contactMethod: item.contactMethod || '',
      contactInfo: item.contactInfo || '',
      notes: item.notes || ''
    });
    if (item.avatarData) {
      void calcAspectRatio(item.avatarData)
        .then(setAvatarAspect)
        .catch(() => setAvatarAspect('2 / 1'));
    }
    void loadInfluencerFiles(item.id);
    setEditOpen(true);
  }

  async function loadInfluencerFiles(influencerId: string) {
    try {
      const [auditRes, commentRes] = await Promise.all([
        request(`/api/influencers/${encodeURIComponent(influencerId)}/files`, { params: { kind: 'audit' } }),
        request(`/api/influencers/${encodeURIComponent(influencerId)}/files`, { params: { kind: 'comment' } })
      ]);
      setAuditFiles(Array.isArray(auditRes?.files) ? (auditRes.files as InfluencerFile[]) : []);
      setCommentFiles(Array.isArray(commentRes?.files) ? (commentRes.files as InfluencerFile[]) : []);
    } catch {
      setAuditFiles([]);
      setCommentFiles([]);
    }
  }

  async function remove(item: Influencer) {
    try {
      await request(`/api/influencers/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      message.success(t('influencers.deleteOk'));
      if (lastCreatedIdRef.current === item.id) {
        lastCreatedIdRef.current = '';
        try {
          localStorage.removeItem(LAST_CREATED_INFLUENCER_KEY);
        } catch {}
      }
      await loadInfluencers();
      const maxPage = Math.max(1, Math.ceil((filtered.length - 1) / pageSize));
      if (page > maxPage) setPage(maxPage);
    } catch (error: any) {
      message.error(error?.data?.error || t('influencers.deleteFailed'));
    }
  }

  async function toBase64(file: File) {
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
    return result;
  }

  async function openPreview(item: Influencer, kind: 'audit' | 'comment') {
    setPreviewInfluencer(item);
    setPreviewKind(kind);
    setPreviewFiles([]);
    setPreviewFileId('');
    setPreviewTable(null);
    setPreviewRaw('');
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await request(`/api/influencers/${encodeURIComponent(item.id)}/files`, {
        params: { kind }
      });
      const list = Array.isArray(res?.files) ? (res.files as InfluencerFile[]) : [];
      setPreviewFiles(list);
      if (list.length === 0) {
        return;
      }
      const first = list[0];
      setPreviewFileId(first.id);
      const fileRes = await request(`/api/influencers/${encodeURIComponent(item.id)}/files/${encodeURIComponent(first.id)}`);
      const fileText = String(fileRes?.file?.fileText || '');
      const json = tryParseJson(fileText);
      if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'object' && !Array.isArray(json[0])) {
        const keys = Array.from(new Set(json.flatMap((it: any) => Object.keys(it || {}))));
        const columns = keys.map(k => ({ title: k, dataIndex: k, width: 180, ellipsis: true }));
        const data = (json as any[]).slice(0, 500).map((row, idx) => ({ key: idx, ...row }));
        setPreviewTable({ columns, data });
        setPreviewRaw('');
        return;
      }
      const parsed = parseDelimitedText(fileText);
      if (parsed.columns.length >= 2 && parsed.data.length >= 1) {
        setPreviewTable(parsed);
        setPreviewRaw('');
        return;
      }
      setPreviewTable(null);
      setPreviewRaw(fileText);
    } catch (error: any) {
      message.error(error?.data?.error || t('influencers.filesLoadFailed'));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function switchPreviewFile(fileId: string) {
    const influencer = previewInfluencer;
    if (!influencer) return;
    setPreviewFileId(fileId);
    setPreviewTable(null);
    setPreviewRaw('');
    setPreviewLoading(true);
    try {
      const fileRes = await request(
        `/api/influencers/${encodeURIComponent(influencer.id)}/files/${encodeURIComponent(fileId)}`
      );
      const fileText = String(fileRes?.file?.fileText || '');
      const json = tryParseJson(fileText);
      if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'object' && !Array.isArray(json[0])) {
        const keys = Array.from(new Set(json.flatMap((it: any) => Object.keys(it || {}))));
        const columns = keys.map(k => ({ title: k, dataIndex: k, width: 180, ellipsis: true }));
        const data = (json as any[]).slice(0, 500).map((row, idx) => ({ key: idx, ...row }));
        setPreviewTable({ columns, data });
        setPreviewRaw('');
        return;
      }
      const parsed = parseDelimitedText(fileText);
      if (parsed.columns.length >= 2 && parsed.data.length >= 1) {
        setPreviewTable(parsed);
        setPreviewRaw('');
        return;
      }
      setPreviewTable(null);
      setPreviewRaw(fileText);
    } catch (error: any) {
      message.error(error?.data?.error || t('influencers.filesLoadFailed'));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function doImport(file: File) {
    setImporting(true);
    setImportDone(0);
    try {
      const text = await file.text();
      const parsed = parseDelimitedText(text);
      const headerCells = parsed.columns.map((c: any) => String(c.title || '').trim());
      const header = headerCells.join(',').toLowerCase();
      const dataRows = (parsed.data || []).map((row: any) =>
        Object.keys(row)
          .filter(k => k !== 'key')
          .sort((a, b) => Number(a) - Number(b))
          .map(k => String(row[k] ?? '').trim())
      );
      const headerHints = [
        '达人',
        '昵称',
        '账号',
        '联系',
        '备注',
        'id',
        'link',
        'name',
        'handle',
        'contact',
        'note',
        'profile',
        'koc',
        'tên',
        'liên',
        'ghi'
      ];
      const looksLikeHeader = headerHints.some(h => header.includes(h));
      const cleanRows = looksLikeHeader ? dataRows : [headerCells, ...dataRows];

      setImportRows(cleanRows.length);
      let done = 0;
      for (const r of cleanRows) {
        const payload = {
          displayName: r[0] || '',
          handle: r[1] || '',
          contactMethod: r[2] || '',
          contactInfo: r[3] || '',
          notes: r[4] || '',
          profileLink: r[5] || ''
        };
        if (!payload.displayName && !payload.handle) {
          done++;
          setImportDone(done);
          continue;
        }
        await request('/api/influencers', { method: 'POST', data: payload });
        done++;
        setImportDone(done);
      }
      message.success(t('influencers.importDone'));
      setImportOpen(false);
      await loadInfluencers();
      setPage(1);
    } catch (error: any) {
      message.error(error?.data?.error || error?.message || t('influencers.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageContainer title={t('influencers.title')}>
      <ProCard
        bordered
        className="koc-card-shell"
        bodyStyle={{ padding: 16 }}
        title={
          <div>
            <div style={{ fontWeight: 700 }}>{t('influencers.profileTitle')}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('influencers.profileSub')}
            </Typography.Text>
          </div>
        }
        extra={
          <Space>
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
              {t('influencers.add')}
            </Button>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              {t('influencers.import')}
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Input
            style={{ width: 240 }}
            placeholder={t('influencers.searchPlaceholder')}
            allowClear
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="koc-grid">
          {paged.map(item => (
            <ProCard key={item.id} bordered className="koc-item" bodyStyle={{ padding: 14 }}>
              <div className="koc-cover">
                {item.avatarData ? (
                  <Image src={item.avatarData} preview={{ src: item.avatarData }} />
                ) : (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(15,23,42,0.35)' }}>
                    {t('influencers.noAvatar')}
                  </div>
                )}
              </div>

              <div className="koc-meta">
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.displayName || '-'}</div>
                <div style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>{item.handle ? `@${item.handle}` : ''}</div>

                <div className="koc-row">
                  <span className="koc-label">{t('influencers.idLink')}：</span>
                  {item.profileLink ? (
                    <a className="koc-link" href={item.profileLink} target="_blank" rel="noreferrer">
                      {item.profileLink}
                    </a>
                  ) : (
                    <span className="koc-link">-</span>
                  )}
                </div>

                <div className="koc-row">
                  <span className="koc-label">{t('influencers.audit')}：</span>
                  {normalizeDigit(item.auditFileCount) > 0 ? (
                    <a className="koc-link" onClick={() => void openPreview(item, 'audit')}>
                      {t('common.view')}
                    </a>
                  ) : (
                    <span className="koc-link">-</span>
                  )}
                </div>

                <div className="koc-row">
                  <span className="koc-label">{t('influencers.comment')}：</span>
                  {normalizeDigit(item.commentFileCount) > 0 ? (
                    <a className="koc-link" onClick={() => void openPreview(item, 'comment')}>
                      {t('common.view')}
                    </a>
                  ) : (
                    <span className="koc-link">-</span>
                  )}
                </div>

                <div className="koc-row">
                  <span className="koc-label">{t('influencers.contact')}：</span>
                  <span className="koc-link">{item.contactMethod || t('influencers.contactMissing')}</span>
                </div>
                <div className="koc-row">
                  <span className="koc-label">&nbsp;</span>
                  <span className="koc-link">{item.contactInfo || '-'}</span>
                </div>
              </div>

              <div className="koc-actions">
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(item)} />
                <Popconfirm
                  title={t('influencers.deleteConfirm')}
                  okText={t('common.delete')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => remove(item)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </ProCard>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, gap: 12, flexWrap: 'wrap' }}>
          <Space size={10} style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>
            <span>{t('pagination.total', { total: filtered.length })}</span>
            <Select
              value={pageSize}
              style={{ width: 110 }}
              options={[14, 21, 28, 35].map(v => ({ label: t('pagination.perPage', { size: v }), value: v }))}
              onChange={value => {
                setPageSize(value);
                setPage(1);
              }}
            />
          </Space>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={filtered.length}
            showQuickJumper
            onChange={p => setPage(p)}
          />
        </div>
      </ProCard>

      <Modal
        open={editOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>{editing ? t('influencers.edit') : t('influencers.add')}</span>
            <Button onClick={() => setEditOpen(false)}>{t('common.close')}</Button>
          </div>
        }
        closable={false}
        onCancel={() => setEditOpen(false)}
        footer={null}
        destroyOnClose
        width={980}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async values => {
            setSaving(true);
            try {
              const payload = {
                displayName: String(values.displayName || '').trim(),
                handle: stripAtPrefix(values.handle || ''),
                profileLink: String(values.profileLink || '').trim(),
                contactMethod: String(values.contactMethod || '').trim(),
                contactInfo: String(values.contactInfo || '').trim(),
                notes: String(values.notes || '').trim(),
                avatarData
              };

              let influencerId = editing?.id || '';
              if (editing) {
                await request(`/api/influencers/${encodeURIComponent(editing.id)}`, { method: 'PUT', data: payload });
                message.success(t('influencers.saveOk'));
              } else {
                const res = await request('/api/influencers', { method: 'POST', data: payload });
                influencerId = res?.influencer?.id ? String(res.influencer.id) : '';
                if (influencerId) {
                  lastCreatedIdRef.current = influencerId;
                  try {
                    localStorage.setItem(LAST_CREATED_INFLUENCER_KEY, influencerId);
                  } catch {}
                }
                message.success(t('influencers.createOk'));
                setPage(1);
              }

              if (influencerId && (pendingAuditUploads.length || pendingCommentUploads.length)) {
                setFileBusy(true);
                const uploadOne = async (file: File, kind: 'audit' | 'comment') => {
                  const fileText = await file.text();
                  await request(`/api/influencers/${encodeURIComponent(influencerId)}/files`, {
                    method: 'POST',
                    data: { kind, fileName: file.name, fileText }
                  });
                };
                for (const f of pendingAuditUploads) await uploadOne(f, 'audit');
                for (const f of pendingCommentUploads) await uploadOne(f, 'comment');
                setPendingAuditUploads([]);
                setPendingCommentUploads([]);
                await loadInfluencerFiles(influencerId);
              }

              setEditOpen(false);
              await loadInfluencers();
            } catch (error: any) {
              message.error(error?.data?.error || t('influencers.saveFailed'));
            } finally {
              setSaving(false);
              setFileBusy(false);
            }
          }}
        >
          <div className="koc-edit-grid">
            <Form.Item
              name="displayName"
              label={t('influencers.displayName')}
              rules={[{ required: true, message: t('influencers.displayNameRequired') }]}
            >
              <Input placeholder={t('influencers.displayName')} />
            </Form.Item>
            <Form.Item name="handle" label={t('influencers.handle')}>
              <Input prefix="@" placeholder={t('influencers.handle')} />
            </Form.Item>

            <Form.Item name="profileLink" label={t('influencers.profileLinkLabel')} className="koc-edit-full">
              <Input placeholder="https://www.tiktok.com/@xxx" />
            </Form.Item>

            <div className="koc-edit-full">
              <div className="koc-edit-grid">
                <div>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>{t('influencers.photo')}</div>
                  <Upload
                    accept="image/*"
                    maxCount={1}
                    showUploadList={false}
                    beforeUpload={async file => {
                      try {
                        const dataUrl = await toBase64(file as File);
                        setAvatarData(dataUrl);
                        void calcAspectRatio(dataUrl)
                          .then(setAvatarAspect)
                          .catch(() => setAvatarAspect('2 / 1'));
                      } catch (e: any) {
                        message.error(e?.message || '读取图片失败');
                      }
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>{t('common.selectFile')}</Button>
                  </Upload>
                  <div className="koc-edit-help">{t('influencers.photoHelp')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>{t('influencers.photoPreview')}</div>
                  <div
                    className={avatarData ? 'koc-preview-card has-image' : 'koc-preview-card'}
                    style={
                      avatarData
                        ? ({
                            ['--koc-preview-bg' as any]: `url(${avatarData})`,
                            ['--koc-preview-ar' as any]: avatarAspect
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {avatarData ? <img src={avatarData} alt="" /> : null}
                    {avatarData ? (
                      <div
                        className="koc-preview-x"
                        onClick={() => {
                          setAvatarData('');
                          setAvatarAspect('2 / 1');
                        }}
                      >
                        ×
                      </div>
                    ) : (
                      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(15,23,42,0.35)', fontSize: 12 }}>
                        {t('influencers.notUploaded')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 14, marginBottom: 6 }}>{t('influencers.auditFiles')}</div>
              <Upload
                accept=".csv,.json,text/csv,application/json"
                multiple
                showUploadList={false}
                beforeUpload={async file => {
                  if (!editing?.id) {
                    setPendingAuditUploads(prev => [...prev, file as File]);
                    message.success(t('influencers.uploadQueued'));
                    return false;
                  }
                  setFileBusy(true);
                  try {
                    const fileText = await (file as File).text();
                    await request(`/api/influencers/${encodeURIComponent(editing.id)}/files`, {
                      method: 'POST',
                      data: { kind: 'audit', fileName: (file as File).name, fileText }
                    });
                    await loadInfluencerFiles(editing.id);
                    message.success(t('influencers.uploaded'));
                  } catch (error: any) {
                    message.error(error?.data?.error || t('influencers.uploadFailed'));
                  } finally {
                    setFileBusy(false);
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} disabled={fileBusy}>
                  {t('common.selectFile')}
                </Button>
              </Upload>
              <div className="koc-edit-help">
                {t('influencers.filesUploadedCount', { count: auditFiles.length + pendingAuditUploads.length })}
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingAuditUploads.map((f, idx) => (
                  <div key={`pa-${idx}`} className="koc-file-card">
                    <div className="koc-file-card-title">{f.name}</div>
                    <div className="koc-file-card-time">{t('influencers.pendingUpload')}</div>
                    <div
                      className="koc-file-card-x"
                      onClick={() => setPendingAuditUploads(prev => prev.filter((_, i) => i !== idx))}
                    >
                      ×
                    </div>
                  </div>
                ))}
                {auditFiles.map(f => (
                  <div key={f.id} className="koc-file-card">
                    <div className="koc-file-card-title">{f.fileName}</div>
                    <div className="koc-file-card-time">{fmtDateTime(f.createdAt)}</div>
                    <div
                      className="koc-file-card-x"
                      onClick={async () => {
                        if (!editing?.id) return;
                        setFileBusy(true);
                        try {
                          await request(
                            `/api/influencers/${encodeURIComponent(editing.id)}/files/${encodeURIComponent(f.id)}`,
                            { method: 'DELETE' }
                          );
                          await loadInfluencerFiles(editing.id);
                        } catch (error: any) {
                          message.error(error?.data?.error || t('influencers.deleteFailed'));
                        } finally {
                          setFileBusy(false);
                        }
                      }}
                    >
                      ×
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 14, marginBottom: 6 }}>{t('influencers.commentFiles')}</div>
              <Upload
                accept=".csv,.json,text/csv,application/json"
                multiple
                showUploadList={false}
                beforeUpload={async file => {
                  if (!editing?.id) {
                    setPendingCommentUploads(prev => [...prev, file as File]);
                    message.success(t('influencers.uploadQueued'));
                    return false;
                  }
                  setFileBusy(true);
                  try {
                    const fileText = await (file as File).text();
                    await request(`/api/influencers/${encodeURIComponent(editing.id)}/files`, {
                      method: 'POST',
                      data: { kind: 'comment', fileName: (file as File).name, fileText }
                    });
                    await loadInfluencerFiles(editing.id);
                    message.success(t('influencers.uploaded'));
                  } catch (error: any) {
                    message.error(error?.data?.error || t('influencers.uploadFailed'));
                  } finally {
                    setFileBusy(false);
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} disabled={fileBusy}>
                  {t('common.selectFile')}
                </Button>
              </Upload>
              <div className="koc-edit-help">
                {t('influencers.filesUploadedCount', { count: commentFiles.length + pendingCommentUploads.length })}
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingCommentUploads.map((f, idx) => (
                  <div key={`pc-${idx}`} className="koc-file-card">
                    <div className="koc-file-card-title">{f.name}</div>
                    <div className="koc-file-card-time">{t('influencers.pendingUpload')}</div>
                    <div
                      className="koc-file-card-x"
                      onClick={() => setPendingCommentUploads(prev => prev.filter((_, i) => i !== idx))}
                    >
                      ×
                    </div>
                  </div>
                ))}
                {commentFiles.map(f => (
                  <div key={f.id} className="koc-file-card">
                    <div className="koc-file-card-title">{f.fileName}</div>
                    <div className="koc-file-card-time">{fmtDateTime(f.createdAt)}</div>
                    <div
                      className="koc-file-card-x"
                      onClick={async () => {
                        if (!editing?.id) return;
                        setFileBusy(true);
                        try {
                          await request(
                            `/api/influencers/${encodeURIComponent(editing.id)}/files/${encodeURIComponent(f.id)}`,
                            { method: 'DELETE' }
                          );
                          await loadInfluencerFiles(editing.id);
                        } catch (error: any) {
                          message.error(error?.data?.error || t('influencers.deleteFailed'));
                        } finally {
                          setFileBusy(false);
                        }
                      }}
                    >
                      ×
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Form.Item name="contactMethod" label={t('influencers.contactMethod')}>
              <Input placeholder={t('influencers.contactMethod')} />
            </Form.Item>
            <Form.Item name="contactInfo" label={t('influencers.contactInfo')}>
              <Input placeholder={t('influencers.contactInfo')} />
            </Form.Item>

            <Form.Item name="notes" label={t('influencers.notes')} className="koc-edit-full">
              <Input.TextArea rows={4} placeholder={t('influencers.notes')} />
            </Form.Item>

            <div className="koc-edit-full" style={{ display: 'flex', gap: 10 }}>
              <Button type="primary" htmlType="submit" loading={saving || fileBusy}>
                {t('common.save')}
              </Button>
              <Button onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            </div>
          </div>
        </Form>
      </Modal>

      <Modal
        open={importOpen}
        title={t('influencers.importTitle')}
        onCancel={() => (importing ? null : setImportOpen(false))}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12 }}>
          {t('influencers.importCsvTip')}
        </Typography.Paragraph>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          showUploadList={false}
          beforeUpload={file => {
            void doImport(file as File);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} disabled={importing} loading={importing}>
            {t('influencers.importStart')}
          </Button>
        </Upload>
        {importing ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(15,23,42,0.55)' }}>
            {t('influencers.importProgress', { done: importDone, total: importRows })}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={previewOpen}
        title={`${previewInfluencer?.displayName || ''}${previewKind === 'audit' ? t('preview.auditSuffix') : t('preview.commentSuffix')}`}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={1100}
        destroyOnClose
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Select
            style={{ minWidth: 320 }}
            placeholder={t('preview.selectFile')}
            value={previewFileId || undefined}
            options={previewFiles.map(f => ({ label: f.fileName, value: f.id }))}
            onChange={value => void switchPreviewFile(value)}
          />
          <div style={{ color: 'rgba(15,23,42,0.55)', fontSize: 12 }}>
            {previewFiles.length ? t('preview.summary', { count: previewFiles.length }) : t('preview.noFiles')}
          </div>
        </div>

        {previewTable ? (
          <Table
            size="small"
            loading={previewLoading}
            columns={previewTable.columns}
            dataSource={previewTable.data}
            pagination={false}
            scroll={{ x: 'max-content', y: 520 }}
          />
        ) : (
          <pre style={{ margin: 0, maxHeight: 560, overflow: 'auto', background: 'rgba(15,23,42,0.04)', padding: 12, borderRadius: 12 }}>
            {previewLoading ? t('preview.loading') : previewRaw || t('preview.empty')}
          </pre>
        )}
      </Modal>
    </PageContainer>
  );
}
