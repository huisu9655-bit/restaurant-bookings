const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const config = require('./config');

const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_JSON = path.join(DATA_DIR, 'bookings.json');
const DEFAULT_STORES = [
  { id: 'store-mlzg', name: '麻辣掌柜', address: '河内老城区 · 网红街 18 号', imageData: '' },
  { id: 'store-hnkr', name: '河内烤肉店', address: '河内西湖 · 星光商场 3 层', imageData: '' }
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
}

function hashPassword(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

function normalizePgHandle(handleText) {
  return String(handleText || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function loadLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON)) return null;
  try {
    const raw = fs.readFileSync(LEGACY_JSON, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.warn('[pg-store] 无法解析 legacy JSON，已忽略：', error.message);
    return null;
  }
}

function mapStore(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    imageData: row.imagedata ?? row.imageData ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapInfluencer(row) {
  return {
    id: row.id,
    displayName: row.displayName ?? row.displayname ?? row.display_name,
    handle: row.handle || '',
    avatarData: row.avatardata ?? row.avatarData ?? '',
    contactMethod: row.contactmethod ?? row.contactMethod ?? '',
    contactInfo: row.contactinfo ?? row.contactInfo ?? '',
    notes: row.notes || '',
    profileLink: row.profileLink ?? row.profilelink ?? '',
    auditReportName: row.auditReportName ?? row.auditreportname ?? '',
    auditReportText: row.auditReportText ?? row.auditreporttext ?? '',
    commentDetailName: row.commentDetailName ?? row.commentdetailname ?? '',
    commentDetailText: row.commentDetailText ?? row.commentdetailtext ?? '',
    auditFileCount: Number(row.auditFileCount ?? row.auditfilecount ?? 0),
    commentFileCount: Number(row.commentFileCount ?? row.commentfilecount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapBooking(row) {
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: row.storeName,
    influencerId: row.influencerId,
    creatorName: row.creatorName,
    handle: row.handle || '',
    contactMethod: row.contactMethod || '',
    contactInfo: row.contactInfo || '',
    visitDate: row.visitDate || '',
    visitWindow: row.visitWindow || '',
    sourceType: row.sourceType || '预约',
    serviceDetail: row.serviceDetail || '',
    videoRights: row.videoRights || '',
    postDate: row.postDate || '',
    videoLink: row.videoLink || '',
    budgetMillionVND: Number(row.budgetMillionVND || 0),
    notes: row.notes || '',
    createdAt: row.createdAt
  };
}

function mapTraffic(row) {
  return {
    id: row.id,
    bookingId: row.bookingId || '',
    influencerId: row.influencerId || '',
    influencerName: row.influencerName || '未命名达人',
    storeName: row.storeName || '',
    sourceType: row.sourceType || '预约',
    postDate: row.postDate || '',
    videoLink: row.videoLink || '',
    metrics: {
      views: Number(row.views || 0),
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      saves: Number(row.saves || 0),
      shares: Number(row.shares || 0)
    },
    note: row.note || '',
    capturedAt: row.capturedAt
  };
}

const pool = new Pool({
  connectionString: String(config.DATABASE_URL || '').trim() || undefined,
  max: config.PG_POOL_MAX,
  ssl: config.PG_SSL ? { rejectUnauthorized: false } : undefined
});

let initPromise = null;

async function ensureInit() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!config.DATABASE_URL) {
      throw new Error('未配置 DATABASE_URL，无法启用 PostgreSQL');
    }
    await pool.query('SELECT 1');
    await createTables();
    await migrateSchema();
    await seedInitialData();
  })();
  return initPromise;
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "address" TEXT DEFAULT '',
      "imageData" TEXT DEFAULT '',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS influencers (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "displayName" TEXT NOT NULL,
      "handle" TEXT DEFAULT '',
      "avatarData" TEXT DEFAULT '',
      "contactMethod" TEXT DEFAULT '',
      "contactInfo" TEXT DEFAULT '',
      "notes" TEXT DEFAULT '',
      "profileLink" TEXT DEFAULT '',
      "auditReportName" TEXT DEFAULT '',
      "auditReportText" TEXT DEFAULT '',
      "commentDetailName" TEXT DEFAULT '',
      "commentDetailText" TEXT DEFAULT '',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS influencer_files (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "influencerId" TEXT NOT NULL REFERENCES influencers("id") ON DELETE CASCADE,
      "kind" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "fileText" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_influencer_files_influencerId ON influencer_files("influencerId");
    CREATE INDEX IF NOT EXISTS idx_influencer_files_kind ON influencer_files("kind");
    CREATE TABLE IF NOT EXISTS bookings (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "storeId" TEXT NOT NULL,
      "storeName" TEXT NOT NULL,
      "influencerId" TEXT NOT NULL DEFAULT '',
      "creatorName" TEXT NOT NULL,
      "handle" TEXT DEFAULT '',
      "contactMethod" TEXT DEFAULT '',
      "contactInfo" TEXT DEFAULT '',
      "visitDate" TEXT DEFAULT '',
      "visitWindow" TEXT DEFAULT '',
      "sourceType" TEXT DEFAULT '预约',
      "serviceDetail" TEXT DEFAULT '',
      "videoRights" TEXT DEFAULT '',
      "postDate" TEXT DEFAULT '',
      "videoLink" TEXT DEFAULT '',
      "budgetMillionVND" DOUBLE PRECISION DEFAULT 0,
      "notes" TEXT DEFAULT '',
      "createdAt" TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS traffic_logs (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "bookingId" TEXT DEFAULT '',
      "influencerId" TEXT DEFAULT '',
      "influencerName" TEXT NOT NULL,
      "storeName" TEXT DEFAULT '',
      "sourceType" TEXT DEFAULT '预约',
      "postDate" TEXT DEFAULT '',
      "videoLink" TEXT DEFAULT '',
      "views" INTEGER DEFAULT 0,
      "likes" INTEGER DEFAULT 0,
      "comments" INTEGER DEFAULT 0,
      "saves" INTEGER DEFAULT 0,
      "shares" INTEGER DEFAULT 0,
      "note" TEXT DEFAULT '',
      "capturedAt" TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "username" TEXT UNIQUE NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "role" TEXT DEFAULT 'admin',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
}

async function migrateSchema() {
  await pool.query('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS "auditReportName" TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS "auditReportText" TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS "commentDetailName" TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS "commentDetailText" TEXT DEFAULT \'\'');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS influencer_files (
      seq BIGSERIAL,
      "id" TEXT PRIMARY KEY,
      "influencerId" TEXT NOT NULL REFERENCES influencers("id") ON DELETE CASCADE,
      "kind" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "fileText" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_influencer_files_influencerId ON influencer_files("influencerId")');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_influencer_files_kind ON influencer_files("kind")');

  const { rows: legacyRows } = await pool.query(
    `SELECT "id","auditReportName","auditReportText","commentDetailName","commentDetailText","updatedAt","createdAt"
     FROM influencers
     WHERE ("auditReportText" <> '' OR "commentDetailText" <> '')`
  );
  for (const row of legacyRows) {
    const createdAt = row.updatedAt || row.createdAt || new Date().toISOString();
    if (normalizeString(row.auditReportText)) {
      const { rows: existsRows } = await pool.query(
        'SELECT 1 FROM influencer_files WHERE "influencerId" = $1 AND "kind" = $2 LIMIT 1',
        [row.id, 'audit']
      );
      if (!existsRows.length) {
        await pool.query(
          'INSERT INTO influencer_files ("id","influencerId","kind","fileName","fileText","createdAt") VALUES ($1,$2,$3,$4,$5,$6)',
          [generateId('infFile'), row.id, 'audit', normalizeString(row.auditReportName) || 'audit.csv', row.auditReportText, createdAt]
        );
        await pool.query('UPDATE influencers SET "auditReportName" = \'\', "auditReportText" = \'\' WHERE "id" = $1', [row.id]);
      }
    }
    if (normalizeString(row.commentDetailText)) {
      const { rows: existsRows } = await pool.query(
        'SELECT 1 FROM influencer_files WHERE "influencerId" = $1 AND "kind" = $2 LIMIT 1',
        [row.id, 'comment']
      );
      if (!existsRows.length) {
        await pool.query(
          'INSERT INTO influencer_files ("id","influencerId","kind","fileName","fileText","createdAt") VALUES ($1,$2,$3,$4,$5,$6)',
          [generateId('infFile'), row.id, 'comment', normalizeString(row.commentDetailName) || 'comments.csv', row.commentDetailText, createdAt]
        );
        await pool.query('UPDATE influencers SET "commentDetailName" = \'\', "commentDetailText" = \'\' WHERE "id" = $1', [row.id]);
      }
    }
  }
}

async function seedInitialData() {
  const { rows: storeRows } = await pool.query('SELECT COUNT(1)::int as count FROM stores');
  const hasStores = Number(storeRows[0]?.count || 0) > 0;
  if (!hasStores) {
    await seedFromLegacy();
  }
  const { rows: userRows } = await pool.query('SELECT COUNT(1)::int as count FROM users');
  const hasUsers = Number(userRows[0]?.count || 0) > 0;
  if (!hasUsers) {
    const now = new Date().toISOString();
    await pool.query(
      'INSERT INTO users ("id","username","passwordHash","role","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
      ['user-admin', 'admin', hashPassword('admin123'), 'admin', now, now]
    );
  }
}

async function seedFromLegacy() {
  const legacy = loadLegacyJson();
  const stores = Array.isArray(legacy?.stores) && legacy.stores.length ? legacy.stores : DEFAULT_STORES;
  const influencers = Array.isArray(legacy?.influencers) ? legacy.influencers : [];
  const bookings = Array.isArray(legacy?.bookings) ? legacy.bookings : [];
  const trafficLogs = Array.isArray(legacy?.trafficLogs) ? legacy.trafficLogs : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();

    const storeIds = new Map();
    for (const store of stores) {
      const id = normalizeString(store.id) || generateId('store');
      storeIds.set(id, id);
      await client.query(
        'INSERT INTO stores ("id","name","address","imageData","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
        [
          id,
          normalizeString(store.name) || '未命名门店',
          normalizeString(store.address),
          store.imageData || '',
          store.createdAt || now,
          store.updatedAt || now
        ]
      );
    }

    const influencerIds = new Map();
    for (const inf of influencers) {
      const id = normalizeString(inf.id) || generateId('inf');
      influencerIds.set(id, id);
      await client.query(
        'INSERT INTO influencers ("id","displayName","handle","avatarData","contactMethod","contactInfo","notes","profileLink","auditReportName","auditReportText","commentDetailName","commentDetailText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          id,
          normalizeString(inf.displayName) || '未命名达人',
          normalizeString(inf.handle),
          inf.avatarData || '',
          normalizeString(inf.contactMethod),
          normalizeString(inf.contactInfo),
          normalizeString(inf.notes),
          normalizeString(inf.profileLink || inf.profileUrl || inf.url),
          normalizeString(inf.auditReportName),
          normalizeString(inf.auditReportText),
          normalizeString(inf.commentDetailName),
          normalizeString(inf.commentDetailText),
          inf.createdAt || now,
          inf.updatedAt || now
        ]
      );
    }

    for (const record of bookings) {
      let storeId = normalizeString(record.storeId);
      if (!storeId || !storeIds.has(storeId)) {
        const match = stores.find(store => store.name === record.storeName);
        storeId = match ? normalizeString(match.id) : DEFAULT_STORES[0].id;
      }
      let influencerId = normalizeString(record.influencerId);
      if (!influencerId || !influencerIds.has(influencerId)) {
        const match = influencers.find(inf => inf.displayName === record.creatorName);
        influencerId = match ? normalizeString(match.id) : '';
      }
      await client.query(
        `INSERT INTO bookings (
          "id","storeId","storeName","influencerId","creatorName","handle","contactMethod","contactInfo",
          "visitDate","visitWindow","sourceType","serviceDetail","videoRights","postDate","videoLink",
          "budgetMillionVND","notes","createdAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          record.id || generateId('bk'),
          storeId,
          record.storeName || '未指定门店',
          influencerId,
          record.creatorName || '未命名达人',
          record.handle || '',
          record.contactMethod || '',
          record.contactInfo || '',
          record.visitDate || '',
          record.visitWindow || '',
          record.sourceType === '自来' ? '自来' : '预约',
          record.serviceDetail || '',
          record.videoRights || '',
          record.postDate || '',
          record.videoLink || '',
          record.budgetMillionVND || 0,
          record.notes || '',
          record.createdAt || now
        ]
      );
    }

    for (const log of trafficLogs) {
      await client.query(
        `INSERT INTO traffic_logs (
          "id","bookingId","influencerId","influencerName","storeName","sourceType","postDate","videoLink",
          "views","likes","comments","saves","shares","note","capturedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          log.id || generateId('traffic'),
          log.bookingId || '',
          log.influencerId || '',
          log.influencerName || '未命名达人',
          log.storeName || '',
          log.sourceType || '预约',
          log.postDate || '',
          log.videoLink || '',
          log.metrics?.views || 0,
          log.metrics?.likes || 0,
          log.metrics?.comments || 0,
          log.metrics?.saves || 0,
          log.metrics?.shares || 0,
          log.note || '',
          log.capturedAt || now
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.warn('[pg-store] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getAllStores() {
  await ensureInit();
  const { rows } = await pool.query('SELECT "id" as id, "name" as name, "address" as address, "imageData" as "imageData", "createdAt" as "createdAt", "updatedAt" as "updatedAt" FROM stores ORDER BY lower("name") ASC, seq ASC');
  return rows.map(mapStore);
}

async function createStore(payload = {}) {
  await ensureInit();
  const id = generateId('store');
  const now = new Date().toISOString();
  const record = {
    id,
    name: normalizeString(payload.name) || '未命名门店',
    address: normalizeString(payload.address),
    imageData: normalizeString(payload.imageData),
    createdAt: now,
    updatedAt: now
  };
  await pool.query(
    'INSERT INTO stores ("id","name","address","imageData","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
    [record.id, record.name, record.address, record.imageData, record.createdAt, record.updatedAt]
  );
  return record;
}

async function updateStore(id, payload = {}) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT * FROM stores WHERE "id" = $1', [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('未找到门店');
  const updated = {
    id: existing.id,
    name: normalizeString(payload.name) || existing.name,
    address: payload.address !== undefined ? normalizeString(payload.address) : existing.address,
    imageData:
      payload.imageData !== undefined && payload.imageData !== '' ? normalizeString(payload.imageData) : existing.imageData,
    updatedAt: new Date().toISOString()
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE stores SET "name"=$1, "address"=$2, "imageData"=$3, "updatedAt"=$4 WHERE "id"=$5',
      [updated.name, updated.address, updated.imageData, updated.updatedAt, updated.id]
    );
    await client.query('UPDATE bookings SET "storeName"=$1 WHERE "storeId"=$2', [updated.name, updated.id]);
    await client.query(
      `UPDATE traffic_logs
       SET "storeName"=$1
       WHERE "bookingId" IN (SELECT "id" FROM bookings WHERE "storeId"=$2)`,
      [updated.name, updated.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.warn('[pg-store] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
  return { ...mapStore(existing), ...updated };
}

async function deleteStore(id) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT "id" FROM stores WHERE "id" = $1', [id]);
  if (!existingRows[0]) throw new Error('未找到门店');
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int as count FROM bookings WHERE "storeId" = $1', [id]);
  if (Number(countRows[0]?.count || 0) > 0) throw new Error('存在关联预约，无法删除门店');
  await pool.query('DELETE FROM stores WHERE "id" = $1', [id]);
  return true;
}

async function getAllInfluencers() {
  await ensureInit();
  const { rows } = await pool.query(
    `SELECT influencers.*,
            (SELECT COUNT(1)::int FROM influencer_files f WHERE f."influencerId" = influencers."id" AND f."kind" = 'audit') as "auditFileCount",
            (SELECT COUNT(1)::int FROM influencer_files f WHERE f."influencerId" = influencers."id" AND f."kind" = 'comment') as "commentFileCount"
     FROM influencers
     ORDER BY "createdAt" ASC, seq ASC`
  );
  return rows.map(mapInfluencer);
}

async function createInfluencer(payload = {}) {
  await ensureInit();
  const id = generateId('inf');
  const now = new Date().toISOString();
  const influencer = {
    id,
    displayName: normalizeString(payload.displayName) || '未命名达人',
    handle: normalizeString(payload.handle),
    avatarData: normalizeString(payload.avatarData),
    contactMethod: normalizeString(payload.contactMethod),
    contactInfo: normalizeString(payload.contactInfo),
    notes: normalizeString(payload.notes),
    profileLink: normalizeString(payload.profileLink),
    auditReportName: normalizeString(payload.auditReportName),
    auditReportText: normalizeString(payload.auditReportText),
    commentDetailName: normalizeString(payload.commentDetailName),
    commentDetailText: normalizeString(payload.commentDetailText),
    createdAt: now,
    updatedAt: now
  };
  await pool.query(
    `INSERT INTO influencers ("id","displayName","handle","avatarData","contactMethod","contactInfo","notes","profileLink","auditReportName","auditReportText","commentDetailName","commentDetailText","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      influencer.id,
      influencer.displayName,
      influencer.handle,
      influencer.avatarData,
      influencer.contactMethod,
      influencer.contactInfo,
      influencer.notes,
      influencer.profileLink,
      influencer.auditReportName,
      influencer.auditReportText,
      influencer.commentDetailName,
      influencer.commentDetailText,
      influencer.createdAt,
      influencer.updatedAt
    ]
  );
  return influencer;
}

async function updateInfluencer(id, payload = {}) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT * FROM influencers WHERE "id" = $1', [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('未找到达人');
  const influencer = {
    id,
    displayName: normalizeString(payload.displayName) || existing.displayName,
    handle: normalizeString(payload.handle),
    avatarData: payload.avatarData !== undefined ? normalizeString(payload.avatarData) : existing.avatarData,
    contactMethod: normalizeString(payload.contactMethod),
    contactInfo: normalizeString(payload.contactInfo),
    notes: normalizeString(payload.notes),
    profileLink: normalizeString(payload.profileLink) || existing.profileLink || '',
    auditReportName:
      payload.auditReportName !== undefined ? normalizeString(payload.auditReportName) : existing.auditReportName || '',
    auditReportText:
      payload.auditReportText !== undefined ? normalizeString(payload.auditReportText) : existing.auditReportText || '',
    commentDetailName:
      payload.commentDetailName !== undefined ? normalizeString(payload.commentDetailName) : existing.commentDetailName || '',
    commentDetailText:
      payload.commentDetailText !== undefined ? normalizeString(payload.commentDetailText) : existing.commentDetailText || '',
    updatedAt: new Date().toISOString()
  };
  await pool.query(
    `UPDATE influencers
     SET "displayName"=$1, "handle"=$2, "avatarData"=$3,
         "contactMethod"=$4, "contactInfo"=$5, "notes"=$6, "profileLink"=$7,
         "auditReportName"=$8, "auditReportText"=$9, "commentDetailName"=$10, "commentDetailText"=$11, "updatedAt"=$12
     WHERE "id"=$13`,
    [
      influencer.displayName,
      influencer.handle,
      influencer.avatarData,
      influencer.contactMethod,
      influencer.contactInfo,
      influencer.notes,
      influencer.profileLink,
      influencer.auditReportName,
      influencer.auditReportText,
      influencer.commentDetailName,
      influencer.commentDetailText,
      influencer.updatedAt,
      influencer.id
    ]
  );
  return { ...mapInfluencer(existing), ...influencer };
}

async function deleteInfluencer(id) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT "id" FROM influencers WHERE "id" = $1', [id]);
  if (!existingRows[0]) throw new Error('未找到达人');
  const { rows: bookingRows } = await pool.query('SELECT COUNT(*)::int as count FROM bookings WHERE "influencerId" = $1', [
    id
  ]);
  const { rows: trafficRows } = await pool.query('SELECT COUNT(*)::int as count FROM traffic_logs WHERE "influencerId" = $1', [
    id
  ]);
  if (Number(bookingRows[0]?.count || 0) > 0 || Number(trafficRows[0]?.count || 0) > 0) {
    throw new Error('存在关联预约或流量，无法删除');
  }
  await pool.query('DELETE FROM influencer_files WHERE "influencerId" = $1', [id]);
  await pool.query('DELETE FROM influencers WHERE "id" = $1', [id]);
  return true;
}

async function listInfluencerFiles(influencerId, kind = '') {
  await ensureInit();
  if (!influencerId) throw new Error('未找到达人');
  const kindNorm = normalizeString(kind);
  const args = [influencerId];
  let sql =
    'SELECT "id","influencerId","kind","fileName","createdAt" FROM influencer_files WHERE "influencerId" = $1';
  if (kindNorm) {
    args.push(kindNorm);
    sql += ' AND "kind" = $2';
  }
  sql += ' ORDER BY "createdAt" DESC, seq DESC';
  const { rows } = await pool.query(sql, args);
  return rows.map(row => ({
    id: row.id,
    influencerId: row.influencerId,
    kind: row.kind,
    fileName: row.fileName || '',
    createdAt: row.createdAt
  }));
}

async function getInfluencerFile(influencerId, fileId) {
  await ensureInit();
  if (!influencerId) throw new Error('未找到达人');
  if (!fileId) throw new Error('未找到文件');
  const { rows } = await pool.query(
    'SELECT "id","influencerId","kind","fileName","fileText","createdAt" FROM influencer_files WHERE "influencerId" = $1 AND "id" = $2',
    [influencerId, fileId]
  );
  const row = rows[0];
  if (!row) throw new Error('未找到文件');
  return {
    id: row.id,
    influencerId: row.influencerId,
    kind: row.kind,
    fileName: row.fileName || '',
    fileText: row.fileText || '',
    createdAt: row.createdAt
  };
}

async function createInfluencerFile(influencerId, payload = {}) {
  await ensureInit();
  if (!influencerId) throw new Error('未找到达人');
  const { rows: existingRows } = await pool.query('SELECT "id" FROM influencers WHERE "id" = $1', [influencerId]);
  if (!existingRows[0]) throw new Error('未找到达人');
  const kind = normalizeString(payload.kind);
  if (!['audit', 'comment'].includes(kind)) throw new Error('文件类型不支持');
  const fileName = normalizeString(payload.fileName) || (kind === 'audit' ? 'audit.csv' : 'comments.csv');
  const fileText = normalizeString(payload.fileText);
  if (!fileText) throw new Error('文件内容为空');
  const createdAt = new Date().toISOString();
  const id = generateId('infFile');
  await pool.query(
    'INSERT INTO influencer_files ("id","influencerId","kind","fileName","fileText","createdAt") VALUES ($1,$2,$3,$4,$5,$6)',
    [id, influencerId, kind, fileName, fileText, createdAt]
  );
  return { id, influencerId, kind, fileName, createdAt };
}

async function deleteInfluencerFile(influencerId, fileId) {
  await ensureInit();
  if (!influencerId) throw new Error('未找到达人');
  if (!fileId) throw new Error('未找到文件');
  const res = await pool.query('DELETE FROM influencer_files WHERE "influencerId" = $1 AND "id" = $2', [influencerId, fileId]);
  if (!res.rowCount) throw new Error('未找到文件');
  return true;
}

async function ensureStoreAndInfluencer(storeId, influencerId) {
  const { rows: storeRows } = await pool.query('SELECT "id" as id, "name" as name, "address" as address FROM stores WHERE "id"=$1', [
    storeId
  ]);
  const store = storeRows[0];
  if (!store) throw new Error('未找到门店');
  const { rows: infRows } = await pool.query(
    'SELECT "id" as id, "displayName" as "displayName", "handle" as handle, "contactMethod" as "contactMethod", "contactInfo" as "contactInfo" FROM influencers WHERE "id"=$1',
    [influencerId]
  );
  const influencer = infRows[0];
  if (!influencer) throw new Error('未找到达人');
  return { store, influencer };
}

async function getAllBookings() {
  await ensureInit();
  const { rows } = await pool.query(
    `SELECT * FROM bookings
     ORDER BY (CASE WHEN "visitDate" = '' THEN '0000-00-00' ELSE "visitDate" END) DESC, "createdAt" DESC, seq DESC`
  );
  return rows.map(mapBooking);
}

function filterBookings(records, filters = {}) {
  const keyword = normalizeString(filters.q).toLowerCase();
  const storeFilter = normalizeString(filters.store);
  const startDate = normalizeString(filters.startDate || filters.date);
  const endDate = normalizeString(filters.endDate || filters.date);
  return records.filter(record => {
    if (storeFilter && storeFilter !== 'all' && record.storeId !== storeFilter) {
      return false;
    }
    if (startDate && record.visitDate && record.visitDate < startDate) {
      return false;
    }
    if (endDate && record.visitDate && record.visitDate > endDate) {
      return false;
    }
    if (keyword) {
      const blob = [record.creatorName, record.handle, record.storeName, record.visitDate]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!blob.includes(keyword)) {
        return false;
      }
    }
    return true;
  });
}

function deleteBooking(id) {
  return (async () => {
    await ensureInit();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query('SELECT "id" FROM bookings WHERE "id"=$1', [id]);
      if (!existingRows[0]) throw new Error('未找到预约');
      await client.query('DELETE FROM traffic_logs WHERE "bookingId"=$1', [id]);
      await client.query('DELETE FROM bookings WHERE "id"=$1', [id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  })();
}

function buildSummary(records = []) {
  const totals = {
    count: records.length,
    budgetMillionVND: 0,
    scheduledCount: 0,
    walkInCount: 0
  };
  const upcoming = [];
  const now = Date.now();
  records.forEach(record => {
    totals.budgetMillionVND += record.budgetMillionVND || 0;
    if (record.sourceType === '自来') {
      totals.walkInCount += 1;
    } else {
      totals.scheduledCount += 1;
    }
    if (record.visitDate) {
      const visit = new Date(record.visitDate).getTime();
      if (!Number.isNaN(visit) && visit >= now) {
        upcoming.push({
          id: record.id,
          store: record.storeName,
          creatorName: record.creatorName,
          visitDate: record.visitDate,
          visitWindow: record.visitWindow || ''
        });
      }
    }
  });
  upcoming.sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime());
  return { totals, upcoming: upcoming.slice(0, 6) };
}

async function createBooking(payload = {}) {
  await ensureInit();
  const { store, influencer } = await ensureStoreAndInfluencer(payload.storeId, payload.influencerId);
  const record = {
    id: generateId('bk'),
    storeId: store.id,
    storeName: store.name,
    influencerId: influencer.id,
    creatorName: influencer.displayName,
    handle: influencer.handle || '',
    contactMethod: influencer.contactMethod || '',
    contactInfo: influencer.contactInfo || '',
    visitDate: normalizeString(payload.visitDate),
    visitWindow: normalizeString(payload.visitWindow),
    sourceType: normalizeString(payload.sourceType) === '自来' ? '自来' : '预约',
    serviceDetail: normalizeString(payload.serviceDetail),
    videoRights: normalizeString(payload.videoRights),
    postDate: normalizeString(payload.postDate),
    videoLink: normalizeString(payload.videoLink),
    budgetMillionVND: Math.max(0, parseNumber(payload.budgetMillionVND)),
    notes: normalizeString(payload.notes),
    createdAt: new Date().toISOString()
  };
  await pool.query(
    `INSERT INTO bookings (
      "id","storeId","storeName","influencerId","creatorName","handle","contactMethod","contactInfo",
      "visitDate","visitWindow","sourceType","serviceDetail","videoRights","postDate","videoLink",
      "budgetMillionVND","notes","createdAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      record.id,
      record.storeId,
      record.storeName,
      record.influencerId,
      record.creatorName,
      record.handle,
      record.contactMethod,
      record.contactInfo,
      record.visitDate,
      record.visitWindow,
      record.sourceType,
      record.serviceDetail,
      record.videoRights,
      record.postDate,
      record.videoLink,
      record.budgetMillionVND,
      record.notes,
      record.createdAt
    ]
  );
  return record;
}

async function updateBooking(id, payload = {}) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT * FROM bookings WHERE "id"=$1', [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('未找到预约');
  const storeId = normalizeString(payload.storeId) || existing.storeId;
  const influencerId = normalizeString(payload.influencerId) || existing.influencerId;
  const { store, influencer } = await ensureStoreAndInfluencer(storeId, influencerId);
  const record = {
    id,
    storeId: store.id,
    storeName: store.name,
    influencerId: influencer.id,
    creatorName: influencer.displayName,
    handle: influencer.handle || '',
    contactMethod: influencer.contactMethod || '',
    contactInfo: influencer.contactInfo || '',
    visitDate: normalizeString(payload.visitDate ?? existing.visitDate),
    visitWindow: normalizeString(payload.visitWindow ?? existing.visitWindow),
    sourceType: normalizeString(payload.sourceType ?? existing.sourceType) === '自来' ? '自来' : '预约',
    serviceDetail: normalizeString(payload.serviceDetail ?? existing.serviceDetail),
    videoRights: normalizeString(payload.videoRights ?? existing.videoRights),
    postDate: normalizeString(payload.postDate ?? existing.postDate),
    videoLink: normalizeString(payload.videoLink ?? existing.videoLink),
    budgetMillionVND:
      payload.budgetMillionVND === undefined ? Number(existing.budgetMillionVND || 0) : Math.max(0, parseNumber(payload.budgetMillionVND)),
    notes: normalizeString(payload.notes ?? existing.notes),
    createdAt: existing.createdAt
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE bookings SET
        "storeId"=$1,
        "storeName"=$2,
        "influencerId"=$3,
        "creatorName"=$4,
        "handle"=$5,
        "contactMethod"=$6,
        "contactInfo"=$7,
        "visitDate"=$8,
        "visitWindow"=$9,
        "sourceType"=$10,
        "serviceDetail"=$11,
        "videoRights"=$12,
        "postDate"=$13,
        "videoLink"=$14,
        "budgetMillionVND"=$15,
        "notes"=$16
      WHERE "id"=$17`,
      [
        record.storeId,
        record.storeName,
        record.influencerId,
        record.creatorName,
        record.handle,
        record.contactMethod,
        record.contactInfo,
        record.visitDate,
        record.visitWindow,
        record.sourceType,
        record.serviceDetail,
        record.videoRights,
        record.postDate,
        record.videoLink,
        record.budgetMillionVND,
        record.notes,
        record.id
      ]
    );
    await client.query(
      `UPDATE traffic_logs
       SET "influencerId"=$1,
           "influencerName"=$2,
           "storeName"=$3,
           "sourceType"=$4
       WHERE "bookingId"=$5`,
      [record.influencerId, record.creatorName, record.storeName, record.sourceType, record.id]
    );
    if (record.postDate !== existing.postDate) {
      await client.query(
        `UPDATE traffic_logs
         SET "postDate"=$1
         WHERE "bookingId"=$2 AND ("postDate" = '' OR "postDate" = $3)`,
        [record.postDate, record.id, existing.postDate || '']
      );
    }
    if (record.videoLink !== existing.videoLink) {
      await client.query(
        `UPDATE traffic_logs
         SET "videoLink"=$1
         WHERE "bookingId"=$2 AND ("videoLink" = '' OR "videoLink" = $3)`,
        [record.videoLink, record.id, existing.videoLink || '']
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
  const { rows } = await pool.query('SELECT * FROM bookings WHERE "id"=$1', [id]);
  return mapBooking(rows[0]);
}

async function getStoreOptions() {
  await ensureInit();
  const { rows } = await pool.query('SELECT "id" as id, "name" as name FROM stores ORDER BY lower("name") ASC, seq ASC');
  return rows;
}

async function getAllTrafficLogs() {
  await ensureInit();
  const { rows } = await pool.query('SELECT * FROM traffic_logs ORDER BY "capturedAt" DESC, seq DESC');
  return rows.map(mapTraffic);
}

async function createTrafficLog(payload = {}) {
  await ensureInit();
  const bookingId = normalizeString(payload.bookingId);
  let booking = null;
  if (bookingId) {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE "id"=$1', [bookingId]);
    booking = rows[0] || null;
  }
  let influencer = null;
  if (!booking && payload.influencerId) {
    const { rows } = await pool.query('SELECT * FROM influencers WHERE "id"=$1', [payload.influencerId]);
    influencer = rows[0] || null;
  }
  if (!booking && !influencer) throw new Error('请关联预约或指定达人');
  const log = {
    id: generateId('traffic'),
    bookingId: booking ? booking.id : '',
    influencerId: booking ? booking.influencerId : influencer.id,
    influencerName: booking ? booking.creatorName : influencer.displayName,
    storeName: booking ? booking.storeName : '',
    sourceType: booking ? booking.sourceType : '预约',
    postDate: normalizeString(payload.postDate || booking?.postDate),
    videoLink: normalizeString(payload.videoLink || booking?.videoLink),
    views: Math.max(0, parseNumber(payload.views)),
    likes: Math.max(0, parseNumber(payload.likes)),
    comments: Math.max(0, parseNumber(payload.comments)),
    saves: Math.max(0, parseNumber(payload.saves)),
    shares: Math.max(0, parseNumber(payload.shares)),
    note: normalizeString(payload.note),
    capturedAt: new Date().toISOString()
  };
  await pool.query(
    `INSERT INTO traffic_logs (
      "id","bookingId","influencerId","influencerName","storeName","sourceType","postDate","videoLink",
      "views","likes","comments","saves","shares","note","capturedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      log.id,
      log.bookingId,
      log.influencerId,
      log.influencerName,
      log.storeName,
      log.sourceType,
      log.postDate,
      log.videoLink,
      log.views,
      log.likes,
      log.comments,
      log.saves,
      log.shares,
      log.note,
      log.capturedAt
    ]
  );
  return mapTraffic(log);
}

async function updateTrafficLog(id, payload = {}) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT * FROM traffic_logs WHERE "id"=$1', [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('未找到流量记录');
  let booking = null;
  if (existing.bookingId) {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE "id"=$1', [existing.bookingId]);
    booking = rows[0] || null;
  }
  let influencer = null;
  if (booking) {
    const { rows } = await pool.query('SELECT "id" as id, "displayName" as "displayName" FROM influencers WHERE "id"=$1', [
      booking.influencerId
    ]);
    influencer = rows[0] || null;
  } else if (existing.influencerId) {
    const { rows } = await pool.query('SELECT "id" as id, "displayName" as "displayName" FROM influencers WHERE "id"=$1', [
      existing.influencerId
    ]);
    influencer = rows[0] || null;
  }
  const updated = {
    id: existing.id,
    bookingId: existing.bookingId,
    influencerId: influencer?.id || existing.influencerId,
    influencerName: influencer?.displayName || existing.influencerName,
    storeName: booking?.storeName || existing.storeName,
    sourceType: booking?.sourceType || existing.sourceType,
    postDate: normalizeString(payload.postDate || existing.postDate),
    videoLink: normalizeString(payload.videoLink || existing.videoLink),
    views: Math.max(0, parseNumber(payload.views ?? existing.views)),
    likes: Math.max(0, parseNumber(payload.likes ?? existing.likes)),
    comments: Math.max(0, parseNumber(payload.comments ?? existing.comments)),
    saves: Math.max(0, parseNumber(payload.saves ?? existing.saves)),
    shares: Math.max(0, parseNumber(payload.shares ?? existing.shares)),
    note: normalizeString(payload.note ?? existing.note),
    capturedAt: new Date().toISOString()
  };
  await pool.query(
    `UPDATE traffic_logs
     SET "influencerId"=$1, "influencerName"=$2, "storeName"=$3, "sourceType"=$4,
         "postDate"=$5, "videoLink"=$6, "views"=$7, "likes"=$8, "comments"=$9,
         "saves"=$10, "shares"=$11, "note"=$12, "capturedAt"=$13
     WHERE "id"=$14`,
    [
      updated.influencerId,
      updated.influencerName,
      updated.storeName,
      updated.sourceType,
      updated.postDate,
      updated.videoLink,
      updated.views,
      updated.likes,
      updated.comments,
      updated.saves,
      updated.shares,
      updated.note,
      updated.capturedAt,
      updated.id
    ]
  );
  return mapTraffic(updated);
}

async function updateTrafficMetrics(id, metrics = {}, postDate) {
  await ensureInit();
  const { rows: existingRows } = await pool.query('SELECT * FROM traffic_logs WHERE "id"=$1', [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('未找到流量记录');
  const updated = {
    ...existing,
    postDate: normalizeString(postDate || existing.postDate),
    views: Math.max(0, parseNumber(metrics.views ?? existing.views)),
    likes: Math.max(0, parseNumber(metrics.likes ?? existing.likes)),
    comments: Math.max(0, parseNumber(metrics.comments ?? existing.comments)),
    saves: Math.max(0, parseNumber(metrics.saves ?? existing.saves)),
    shares: Math.max(0, parseNumber(metrics.shares ?? existing.shares)),
    capturedAt: new Date().toISOString()
  };
  await pool.query(
    `UPDATE traffic_logs
     SET "postDate"=$1, "views"=$2, "likes"=$3, "comments"=$4,
         "saves"=$5, "shares"=$6, "capturedAt"=$7
     WHERE "id"=$8`,
    [updated.postDate, updated.views, updated.likes, updated.comments, updated.saves, updated.shares, updated.capturedAt, id]
  );
  return mapTraffic(updated);
}

async function getTrafficLogsForRefresh(limit = 100) {
  await ensureInit();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const { rows } = await pool.query(
    `SELECT "id" as id, "videoLink" as "videoLink"
     FROM traffic_logs
     WHERE "videoLink" IS NOT NULL AND "videoLink" != ''
     ORDER BY "capturedAt" DESC
     LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

async function buildOverview() {
  await ensureInit();
  const { rows: totalsRows } = await pool.query(
    `SELECT
        COUNT(*)::int as count,
        SUM(CASE WHEN "sourceType" = '预约' THEN 1 ELSE 0 END)::int as "scheduledCount",
        SUM(CASE WHEN "sourceType" = '自来' THEN 1 ELSE 0 END)::int as "walkInCount",
        COALESCE(SUM("budgetMillionVND"), 0)::float as "budgetMillionVND"
     FROM bookings`
  );
  const totals = totalsRows[0] || { count: 0, scheduledCount: 0, walkInCount: 0, budgetMillionVND: 0 };
  const { rows: upcoming } = await pool.query(
    `SELECT "id" as id, "storeName" as store, "creatorName" as "creatorName", "visitDate" as "visitDate", "visitWindow" as "visitWindow"
     FROM bookings
     WHERE "visitDate" != '' AND "visitDate" >= to_char(current_date, 'YYYY-MM-DD')
     ORDER BY "visitDate" ASC
     LIMIT 6`
  );
  const { rows: trafficTotalsRows } = await pool.query(
    `SELECT COALESCE(SUM("views"),0)::int as views,
            COALESCE(SUM("likes"),0)::int as likes,
            COALESCE(SUM("comments"),0)::int as comments,
            COALESCE(SUM("saves"),0)::int as saves,
            COALESCE(SUM("shares"),0)::int as shares
     FROM traffic_logs`
  );
  const trafficTotals = trafficTotalsRows[0] || { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
  const { rows: latestTrafficRows } = await pool.query(
    `SELECT * FROM traffic_logs
     ORDER BY COALESCE("views", 0) DESC, "capturedAt" DESC
     LIMIT 200`
  );
  const latestTraffic = latestTrafficRows.map(mapTraffic);
  const bookings = await getAllBookings();
  const { rows: infCountRows } = await pool.query('SELECT COUNT(*)::int as count FROM influencers');
  const { rows: storeCountRows } = await pool.query('SELECT COUNT(*)::int as count FROM stores');
  return {
    bookings: { totals, upcoming },
    traffic: trafficTotals,
    totalInfluencers: Number(infCountRows[0]?.count || 0),
    totalStores: Number(storeCountRows[0]?.count || 0),
    latestTraffic
  };
}

async function getAllUsers() {
  await ensureInit();
  const { rows } = await pool.query('SELECT "id" as id, "username" as username, "role" as role FROM users ORDER BY lower("username") ASC, seq ASC');
  return rows;
}

async function createUser(payload = {}) {
  await ensureInit();
  const username = normalizeString(payload.username).toLowerCase();
  const password = normalizeString(payload.password);
  if (!username) throw new Error('用户名不能为空');
  if (!password) throw new Error('密码不能为空');
  const now = new Date().toISOString();
  const user = {
    id: generateId('user'),
    username,
    passwordHash: hashPassword(password),
    role: 'admin',
    createdAt: now,
    updatedAt: now
  };
  try {
    await pool.query(
      'INSERT INTO users ("id","username","passwordHash","role","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
      [user.id, user.username, user.passwordHash, user.role, user.createdAt, user.updatedAt]
    );
  } catch (error) {
    if (error && error.code === '23505') {
      throw new Error('用户名已存在');
    }
    throw error;
  }
  return { id: user.id, username: user.username, role: user.role };
}

async function updateUserPassword(id, password) {
  await ensureInit();
  if (!password) throw new Error('密码不能为空');
  const updatedAt = new Date().toISOString();
  const result = await pool.query('UPDATE users SET "passwordHash"=$1, "updatedAt"=$2 WHERE "id"=$3', [
    hashPassword(password),
    updatedAt,
    id
  ]);
  if (!result.rowCount) throw new Error('未找到用户');
  const { rows } = await pool.query('SELECT "id" as id, "username" as username, "role" as role FROM users WHERE "id"=$1', [id]);
  return rows[0];
}

async function findUserByUsername(username) {
  await ensureInit();
  if (!username) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE "username"=$1', [String(username).toLowerCase()]);
  return rows[0] || null;
}

module.exports = {
  getAllStores,
  createStore,
  updateStore,
  deleteStore,
  getAllInfluencers,
  createInfluencer,
  updateInfluencer,
  deleteInfluencer,
  listInfluencerFiles,
  getInfluencerFile,
  createInfluencerFile,
  deleteInfluencerFile,
  getAllBookings,
  updateBooking,
  deleteBooking,
  filterBookings,
  buildSummary,
  createBooking,
  getStoreOptions,
  getAllTrafficLogs,
  createTrafficLog,
  updateTrafficLog,
  updateTrafficMetrics,
  getTrafficLogsForRefresh,
  buildOverview,
  getAllUsers,
  createUser,
  updateUserPassword,
  findUserByUsername,
  hashPassword,
  normalizePgHandle
};
