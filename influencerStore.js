const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const LEGACY_JSON = path.join(DATA_DIR, 'bookings.json');
const DEFAULT_STORES = [
  { id: 'store-mlzg', name: '麻辣掌柜', address: '河内老城区 · 网红街 18 号', imageData: '' },
  { id: 'store-hnkr', name: '河内烤肉店', address: '河内西湖 · 星光商场 3 层', imageData: '' }
];

let db = null;

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

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function initDatabase() {
  ensureDir();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  createTables();
  migrateSchema();
  seedInitialData();
}

function migrateSchema() {
  const columns = db.prepare('PRAGMA table_info(influencers)').all();
  const hasProfileLink = columns.some(col => col.name === 'profileLink');
  if (!hasProfileLink) {
    db.exec(`ALTER TABLE influencers ADD COLUMN profileLink TEXT DEFAULT ''`);
  }
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      imageData TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS influencers (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      handle TEXT DEFAULT '',
      avatarData TEXT DEFAULT '',
      contactMethod TEXT DEFAULT '',
      contactInfo TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      profileLink TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      storeId TEXT NOT NULL,
      storeName TEXT NOT NULL,
      influencerId TEXT NOT NULL,
      creatorName TEXT NOT NULL,
      handle TEXT DEFAULT '',
      contactMethod TEXT DEFAULT '',
      contactInfo TEXT DEFAULT '',
      visitDate TEXT DEFAULT '',
      visitWindow TEXT DEFAULT '',
      sourceType TEXT DEFAULT '预约',
      serviceDetail TEXT DEFAULT '',
      videoRights TEXT DEFAULT '',
      postDate TEXT DEFAULT '',
      videoLink TEXT DEFAULT '',
      budgetMillionVND REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (storeId) REFERENCES stores(id),
      FOREIGN KEY (influencerId) REFERENCES influencers(id)
    );
    CREATE TABLE IF NOT EXISTS traffic_logs (
      id TEXT PRIMARY KEY,
      bookingId TEXT DEFAULT '',
      influencerId TEXT DEFAULT '',
      influencerName TEXT NOT NULL,
      storeName TEXT DEFAULT '',
      sourceType TEXT DEFAULT '预约',
      postDate TEXT DEFAULT '',
      videoLink TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      note TEXT DEFAULT '',
      capturedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

function seedInitialData() {
  const hasStores = db.prepare('SELECT COUNT(1) as count FROM stores').get().count > 0;
  if (!hasStores) {
    seedFromLegacy();
  }
  const hasUsers = db.prepare('SELECT COUNT(1) as count FROM users').get().count > 0;
  if (!hasUsers) {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('user-admin', 'admin', hashPassword('admin123'), 'admin', now, now);
  }
}

function seedFromLegacy() {
  let legacy = null;
  if (fs.existsSync(LEGACY_JSON)) {
    try {
      const raw = fs.readFileSync(LEGACY_JSON, 'utf8');
      legacy = JSON.parse(raw || '{}');
    } catch (error) {
      console.warn('[store] 无法解析 legacy JSON，退回默认数据：', error.message);
    }
  }
  const stores = Array.isArray(legacy?.stores) && legacy.stores.length ? legacy.stores : DEFAULT_STORES;
  const insertStore = db.prepare(
    'INSERT INTO stores (id, name, address, imageData, createdAt, updatedAt) VALUES (@id, @name, @address, @imageData, @createdAt, @updatedAt)'
  );
  const now = new Date().toISOString();
  const storeIds = new Map();
  stores.forEach(store => {
    const id = normalizeString(store.id) || generateId('store');
    storeIds.set(id, id);
    insertStore.run({
      id,
      name: normalizeString(store.name) || '未命名门店',
      address: normalizeString(store.address),
      imageData: store.imageData || '',
      createdAt: store.createdAt || now,
      updatedAt: store.updatedAt || now
    });
  });

  const insertInfluencer = db.prepare(
    'INSERT INTO influencers (id, displayName, handle, avatarData, contactMethod, contactInfo, notes, profileLink, createdAt, updatedAt) VALUES (@id, @displayName, @handle, @avatarData, @contactMethod, @contactInfo, @notes, @profileLink, @createdAt, @updatedAt)'
  );
  const influencers = Array.isArray(legacy?.influencers) ? legacy.influencers : [];
  const influencerIds = new Map();
  influencers.forEach(inf => {
    const id = normalizeString(inf.id) || generateId('inf');
    influencerIds.set(id, id);
    insertInfluencer.run({
      id,
      displayName: normalizeString(inf.displayName) || '未命名达人',
      handle: normalizeString(inf.handle),
      avatarData: inf.avatarData || '',
      contactMethod: normalizeString(inf.contactMethod),
      contactInfo: normalizeString(inf.contactInfo),
      notes: normalizeString(inf.notes),
      profileLink: normalizeString(inf.profileLink || inf.profileUrl || inf.url),
      createdAt: inf.createdAt || now,
      updatedAt: inf.updatedAt || now
    });
  });

  const insertBooking = db.prepare(
    `INSERT INTO bookings (
      id, storeId, storeName, influencerId, creatorName, handle, contactMethod, contactInfo,
      visitDate, visitWindow, sourceType, serviceDetail, videoRights, postDate, videoLink,
      budgetMillionVND, notes, createdAt
    ) VALUES (
      @id, @storeId, @storeName, @influencerId, @creatorName, @handle, @contactMethod, @contactInfo,
      @visitDate, @visitWindow, @sourceType, @serviceDetail, @videoRights, @postDate, @videoLink,
      @budgetMillionVND, @notes, @createdAt
    )`
  );
  const bookings = Array.isArray(legacy?.bookings) ? legacy.bookings : [];
  bookings.forEach(record => {
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
    insertBooking.run({
      id: record.id || generateId('bk'),
      storeId,
      storeName: record.storeName || '未指定门店',
      influencerId,
      creatorName: record.creatorName || '未命名达人',
      handle: record.handle || '',
      contactMethod: record.contactMethod || '',
      contactInfo: record.contactInfo || '',
      visitDate: record.visitDate || '',
      visitWindow: record.visitWindow || '',
      sourceType: record.sourceType === '自来' ? '自来' : '预约',
      serviceDetail: record.serviceDetail || '',
      videoRights: record.videoRights || '',
      postDate: record.postDate || '',
      videoLink: record.videoLink || '',
      budgetMillionVND: record.budgetMillionVND || 0,
      notes: record.notes || '',
      createdAt: record.createdAt || now
    });
  });

  const insertTraffic = db.prepare(
    `INSERT INTO traffic_logs (
      id, bookingId, influencerId, influencerName, storeName, sourceType, postDate, videoLink,
      views, likes, comments, saves, shares, note, capturedAt
    ) VALUES (
      @id, @bookingId, @influencerId, @influencerName, @storeName, @sourceType, @postDate, @videoLink,
      @views, @likes, @comments, @saves, @shares, @note, @capturedAt
    )`
  );
  const trafficLogs = Array.isArray(legacy?.trafficLogs) ? legacy.trafficLogs : [];
  trafficLogs.forEach(log => {
    insertTraffic.run({
      id: log.id || generateId('traffic'),
      bookingId: log.bookingId || '',
      influencerId: log.influencerId || '',
      influencerName: log.influencerName || '未命名达人',
      storeName: log.storeName || '',
      sourceType: log.sourceType || '预约',
      postDate: log.postDate || '',
      videoLink: log.videoLink || '',
      views: log.metrics?.views || 0,
      likes: log.metrics?.likes || 0,
      comments: log.metrics?.comments || 0,
      saves: log.metrics?.saves || 0,
      shares: log.metrics?.shares || 0,
      note: log.note || '',
      capturedAt: log.capturedAt || now
    });
  });
}

function mapStore(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    imageData: row.imageData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapInfluencer(row) {
  return {
    id: row.id,
    displayName: row.displayName,
    handle: row.handle,
    avatarData: row.avatarData,
    contactMethod: row.contactMethod,
    contactInfo: row.contactInfo,
    notes: row.notes,
    profileLink: row.profileLink || '',
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
    handle: row.handle,
    contactMethod: row.contactMethod,
    contactInfo: row.contactInfo,
    visitDate: row.visitDate,
    visitWindow: row.visitWindow,
    sourceType: row.sourceType,
    serviceDetail: row.serviceDetail,
    videoRights: row.videoRights,
    postDate: row.postDate,
    videoLink: row.videoLink,
    budgetMillionVND: row.budgetMillionVND || 0,
    notes: row.notes,
    createdAt: row.createdAt
  };
}

function mapTraffic(row) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    influencerId: row.influencerId,
    influencerName: row.influencerName,
    storeName: row.storeName,
    sourceType: row.sourceType,
    postDate: row.postDate,
    videoLink: row.videoLink,
    metrics: {
      views: row.views || 0,
      likes: row.likes || 0,
      comments: row.comments || 0,
      shares: row.shares || 0
    },
    note: row.note,
    capturedAt: row.capturedAt
  };
}

function getAllStores() {
  return db.prepare('SELECT * FROM stores ORDER BY name COLLATE NOCASE').all().map(mapStore);
}

function createStore(payload = {}) {
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
  db.prepare(
    'INSERT INTO stores (id, name, address, imageData, createdAt, updatedAt) VALUES (@id, @name, @address, @imageData, @createdAt, @updatedAt)'
  ).run(record);
  return record;
}

function updateStore(id, payload = {}) {
  const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到门店');
  }
  const updated = {
    id: existing.id,
    name: normalizeString(payload.name) || existing.name,
    address: payload.address !== undefined ? normalizeString(payload.address) : existing.address,
    imageData:
      payload.imageData !== undefined && payload.imageData !== ''
        ? normalizeString(payload.imageData)
        : existing.imageData,
    updatedAt: new Date().toISOString()
  };
  db.prepare('UPDATE stores SET name=@name, address=@address, imageData=@imageData, updatedAt=@updatedAt WHERE id=@id').run(
    updated
  );
  // 同步更新已有预约与流量记录里的门店名称，确保前台列表一致
  db.prepare('UPDATE bookings SET storeName = @name WHERE storeId = @id').run(updated);
  db.prepare(
    `UPDATE traffic_logs
     SET storeName = @name
     WHERE bookingId IN (SELECT id FROM bookings WHERE storeId = @id)`
  ).run(updated);
  return { ...existing, ...updated };
}

function deleteStore(id) {
  const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到门店');
  }
  const bookingCount = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE storeId = ?').get(id).count;
  if (bookingCount > 0) {
    throw new Error('存在关联预约，无法删除门店');
  }
  db.prepare('DELETE FROM stores WHERE id = ?').run(id);
  return true;
}

function getAllInfluencers() {
  return db
    // 默认按创建/导入顺序返回，避免导入后被昵称排序打乱。
    .prepare('SELECT * FROM influencers ORDER BY datetime(createdAt) ASC, rowid ASC')
    .all()
    .map(mapInfluencer);
}

function createInfluencer(payload = {}) {
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
    createdAt: now,
    updatedAt: now
  };
  db.prepare(
    `INSERT INTO influencers (id, displayName, handle, avatarData, contactMethod, contactInfo, notes, profileLink, createdAt, updatedAt)
     VALUES (@id, @displayName, @handle, @avatarData, @contactMethod, @contactInfo, @notes, @profileLink, @createdAt, @updatedAt)`
  ).run(influencer);
  return influencer;
}

function updateInfluencer(id, payload = {}) {
  const existing = db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到达人');
  }
  const influencer = {
    id,
    displayName: normalizeString(payload.displayName) || existing.displayName,
    handle: normalizeString(payload.handle),
    avatarData:
      payload.avatarData !== undefined && payload.avatarData !== ''
        ? normalizeString(payload.avatarData)
        : existing.avatarData,
    contactMethod: normalizeString(payload.contactMethod),
    contactInfo: normalizeString(payload.contactInfo),
    notes: normalizeString(payload.notes),
    profileLink: normalizeString(payload.profileLink) || existing.profileLink || '',
    updatedAt: new Date().toISOString()
  };
  db.prepare(
    `UPDATE influencers
     SET displayName=@displayName, handle=@handle, avatarData=@avatarData,
         contactMethod=@contactMethod, contactInfo=@contactInfo, notes=@notes, profileLink=@profileLink, updatedAt=@updatedAt
     WHERE id=@id`
  ).run(influencer);
  return { ...existing, ...influencer };
}

function deleteInfluencer(id) {
  const existing = db.prepare('SELECT id FROM influencers WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到达人');
  }
  const bookingCount = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE influencerId = ?').get(id).count;
  const trafficCount = db.prepare('SELECT COUNT(*) as count FROM traffic_logs WHERE influencerId = ?').get(id).count;
  if (bookingCount > 0 || trafficCount > 0) {
    throw new Error('存在关联预约或流量，无法删除');
  }
  db.prepare('DELETE FROM influencers WHERE id = ?').run(id);
  return true;
}

function ensureStoreAndInfluencer(storeId, influencerId) {
  const store = db.prepare('SELECT id, name, address FROM stores WHERE id = ?').get(storeId);
  if (!store) {
    throw new Error('未找到门店');
  }
  const influencer = db
    .prepare('SELECT id, displayName, handle, contactMethod, contactInfo FROM influencers WHERE id = ?')
    .get(influencerId);
  if (!influencer) {
    throw new Error('未找到达人');
  }
  return { store, influencer };
}

function getAllBookings() {
  return db
    .prepare(
      `SELECT * FROM bookings
       ORDER BY (CASE WHEN visitDate = '' THEN '0000-00-00' ELSE visitDate END) DESC, createdAt DESC`
    )
    .all()
    .map(mapBooking);
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
  const existing = db.prepare('SELECT id FROM bookings WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到预约');
  }
  db.prepare('DELETE FROM traffic_logs WHERE bookingId = ?').run(id);
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  return true;
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

function createBooking(payload = {}) {
  const { store, influencer } = ensureStoreAndInfluencer(payload.storeId, payload.influencerId);
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
  db.prepare(
    `INSERT INTO bookings (
      id, storeId, storeName, influencerId, creatorName, handle, contactMethod, contactInfo,
      visitDate, visitWindow, sourceType, serviceDetail, videoRights, postDate, videoLink,
      budgetMillionVND, notes, createdAt
    ) VALUES (
      @id, @storeId, @storeName, @influencerId, @creatorName, @handle, @contactMethod, @contactInfo,
      @visitDate, @visitWindow, @sourceType, @serviceDetail, @videoRights, @postDate, @videoLink,
      @budgetMillionVND, @notes, @createdAt
    )`
  ).run(record);
  return record;
}

function updateBooking(id, payload = {}) {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到预约');
  }
  const storeId = normalizeString(payload.storeId) || existing.storeId;
  const influencerId = normalizeString(payload.influencerId) || existing.influencerId;
  const { store, influencer } = ensureStoreAndInfluencer(storeId, influencerId);
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
      payload.budgetMillionVND === undefined ? existing.budgetMillionVND || 0 : Math.max(0, parseNumber(payload.budgetMillionVND)),
    notes: normalizeString(payload.notes ?? existing.notes),
    createdAt: existing.createdAt
  };

  db.prepare(
    `UPDATE bookings SET
      storeId=@storeId,
      storeName=@storeName,
      influencerId=@influencerId,
      creatorName=@creatorName,
      handle=@handle,
      contactMethod=@contactMethod,
      contactInfo=@contactInfo,
      visitDate=@visitDate,
      visitWindow=@visitWindow,
      sourceType=@sourceType,
      serviceDetail=@serviceDetail,
      videoRights=@videoRights,
      postDate=@postDate,
      videoLink=@videoLink,
      budgetMillionVND=@budgetMillionVND,
      notes=@notes
    WHERE id=@id`
  ).run(record);

  // 同步关联的流量记录（保持展示一致）
  db.prepare(
    `UPDATE traffic_logs
     SET influencerId=@influencerId,
         influencerName=@influencerName,
         storeName=@storeName,
         sourceType=@sourceType
     WHERE bookingId=@bookingId`
  ).run({
    bookingId: id,
    influencerId: record.influencerId,
    influencerName: record.creatorName,
    storeName: record.storeName,
    sourceType: record.sourceType
  });

  if (record.postDate !== existing.postDate) {
    db.prepare(
      `UPDATE traffic_logs
       SET postDate=@postDate
       WHERE bookingId=@bookingId AND (postDate = '' OR postDate = @prevPostDate)`
    ).run({
      bookingId: id,
      postDate: record.postDate,
      prevPostDate: existing.postDate || ''
    });
  }
  if (record.videoLink !== existing.videoLink) {
    db.prepare(
      `UPDATE traffic_logs
       SET videoLink=@videoLink
       WHERE bookingId=@bookingId AND (videoLink = '' OR videoLink = @prevVideoLink)`
    ).run({
      bookingId: id,
      videoLink: record.videoLink,
      prevVideoLink: existing.videoLink || ''
    });
  }

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  return mapBooking(updated);
}

function getStoreOptions() {
  return db.prepare('SELECT id, name FROM stores ORDER BY name COLLATE NOCASE').all();
}

function getAllTrafficLogs() {
  return db
    .prepare('SELECT * FROM traffic_logs ORDER BY datetime(capturedAt) DESC')
    .all()
    .map(mapTraffic);
}

function createTrafficLog(payload = {}) {
  const booking = payload.bookingId
    ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(payload.bookingId)
    : null;
  const influencer =
    payload.influencerId && !booking
      ? db.prepare('SELECT * FROM influencers WHERE id = ?').get(payload.influencerId)
      : null;
  if (!booking && !influencer) {
    throw new Error('请关联预约或指定达人');
  }
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
  db.prepare(
    `INSERT INTO traffic_logs (
      id, bookingId, influencerId, influencerName, storeName, sourceType, postDate, videoLink,
      views, likes, comments, saves, shares, note, capturedAt
    ) VALUES (
      @id, @bookingId, @influencerId, @influencerName, @storeName, @sourceType, @postDate, @videoLink,
      @views, @likes, @comments, @saves, @shares, @note, @capturedAt
    )`
  ).run(log);
  return mapTraffic(log);
}

function updateTrafficLog(id, payload = {}) {
  const existing = db.prepare('SELECT * FROM traffic_logs WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到流量记录');
  }
  const booking = existing.bookingId
    ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(existing.bookingId)
    : null;
  const influencer = booking
    ? db.prepare('SELECT id, displayName FROM influencers WHERE id = ?').get(booking.influencerId)
    : db.prepare('SELECT id, displayName FROM influencers WHERE id = ?').get(existing.influencerId);
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
  db.prepare(
    `UPDATE traffic_logs
     SET influencerId=@influencerId, influencerName=@influencerName, storeName=@storeName, sourceType=@sourceType,
         postDate=@postDate, videoLink=@videoLink, views=@views, likes=@likes, comments=@comments,
         saves=@saves, shares=@shares, note=@note, capturedAt=@capturedAt
     WHERE id=@id`
  ).run(updated);
  return mapTraffic(updated);
}

function updateTrafficMetrics(id, metrics = {}, postDate) {
  const existing = db.prepare('SELECT * FROM traffic_logs WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('未找到流量记录');
  }
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
  db.prepare(
    `UPDATE traffic_logs
     SET postDate=@postDate, views=@views, likes=@likes, comments=@comments,
         saves=@saves, shares=@shares, capturedAt=@capturedAt
     WHERE id=@id`
  ).run(updated);
  return mapTraffic(updated);
}

function getTrafficLogsForRefresh(limit = 100) {
  return db
    .prepare(
      `SELECT id, videoLink
       FROM traffic_logs
       WHERE videoLink IS NOT NULL AND videoLink != ''
       ORDER BY datetime(capturedAt) DESC
       LIMIT ?`
    )
    .all(limit);
}

function buildOverview() {
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) as count,
        SUM(CASE WHEN sourceType = '预约' THEN 1 ELSE 0 END) as scheduledCount,
        SUM(CASE WHEN sourceType = '自来' THEN 1 ELSE 0 END) as walkInCount,
        IFNULL(SUM(budgetMillionVND), 0) as budgetMillionVND
       FROM bookings`
    )
    .get();
  const upcoming = db
    .prepare(
      `SELECT id, storeName as store, creatorName, visitDate, visitWindow
       FROM bookings
       WHERE visitDate != '' AND visitDate >= date('now')
       ORDER BY visitDate ASC
       LIMIT 6`
    )
    .all();
  const trafficTotals = db
    .prepare(
      `SELECT IFNULL(SUM(views),0) as views,
              IFNULL(SUM(likes),0) as likes,
              IFNULL(SUM(comments),0) as comments,
              IFNULL(SUM(saves),0) as saves,
              IFNULL(SUM(shares),0) as shares
       FROM traffic_logs`
    )
    .get();
  const latestTraffic = db
    .prepare(
      `SELECT * FROM traffic_logs
       ORDER BY COALESCE(views, 0) DESC, datetime(capturedAt) DESC
       LIMIT 200`
    )
    .all()
    .map(mapTraffic);
  const bookings = getAllBookings();
  return {
    bookings: { totals, upcoming },
    traffic: trafficTotals,
    totalInfluencers: db.prepare('SELECT COUNT(*) as count FROM influencers').get().count,
    totalStores: db.prepare('SELECT COUNT(*) as count FROM stores').get().count,
    latestTraffic
  };
}

function getAllUsers() {
  return db.prepare('SELECT id, username, role FROM users ORDER BY username COLLATE NOCASE').all();
}

function createUser(payload = {}) {
  const username = normalizeString(payload.username).toLowerCase();
  const password = normalizeString(payload.password);
  if (!username) {
    throw new Error('用户名不能为空');
  }
  if (!password) {
    throw new Error('密码不能为空');
  }
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
    db.prepare(
      'INSERT INTO users (id, username, passwordHash, role, createdAt, updatedAt) VALUES (@id, @username, @passwordHash, @role, @createdAt, @updatedAt)'
    ).run(user);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new Error('用户名已存在');
    }
    throw error;
  }
  return { id: user.id, username: user.username, role: user.role };
}

function updateUserPassword(id, password) {
  if (!password) {
    throw new Error('密码不能为空');
  }
  const updatedAt = new Date().toISOString();
  const result = db
    .prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?')
    .run(hashPassword(password), updatedAt, id);
  if (!result.changes) {
    throw new Error('未找到用户');
  }
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
}

function findUserByUsername(username) {
  if (!username) return null;
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
}

initDatabase();

module.exports = {
  getAllStores,
  createStore,
  updateStore,
  deleteStore,
  getAllInfluencers,
  createInfluencer,
  updateInfluencer,
  deleteInfluencer,
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
  hashPassword
};
