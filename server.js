const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PORT, MAX_BODY_BYTES } = require('./config');
const {
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
  hashPassword
} = require('./influencerStore');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const activeSessions = new Map();
const TOKEN_TTL = 1000 * 60 * 60 * 12;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      totalBytes += chunk.length || 0;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        if (tooLarge) {
          reject(new Error('请求体过大'));
          return;
        }
        const body = chunks.length ? Buffer.concat(chunks).toString('utf-8') : '';
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error('请求体不是有效的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.issuedAt > TOKEN_TTL) {
      activeSessions.delete(token);
    }
  }
}

function createSession(user) {
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  activeSessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role || 'admin',
    issuedAt: Date.now()
  });
  return token;
}

function authenticate(req) {
  pruneSessions();
  const header = req.headers['authorization'] || '';
  const token = header.replace(/Bearer\s+/i, '').trim();
  if (!token) {
    throw Object.assign(new Error('未登录'), { statusCode: 401 });
  }
  const session = activeSessions.get(token);
  if (!session) {
    throw Object.assign(new Error('登录已失效'), { statusCode: 401 });
  }
  return { token, session };
}

function detectPlatform(videoLink) {
  if (!videoLink) return '';
  try {
    const hostname = new URL(videoLink).hostname;
    if (hostname.includes('tiktok')) return 'TikTok';
    if (hostname.includes('douyin')) return '抖音';
    if (hostname.includes('youtube')) return 'YouTube';
    if (hostname.includes('instagram')) return 'Instagram';
    return hostname;
  } catch (error) {
    return '';
  }
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isoDateFromEpoch(epoch) {
  const raw = Number(epoch);
  if (!Number.isFinite(raw)) return '';
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function extractPostDateFromHtml(html) {
  // TikTok: createTime (seconds), sometimes createTimeISO / createTime in JSON blobs
  const patterns = [
    /"createTime"\s*:\s*"(\d{9,13})"/i,
    /"createTime"\s*:\s*(\d{9,13})/i,
    /create_time["\\]?\s*:\s*["\\]?(\d{9,13})/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const date = isoDateFromEpoch(match[1]);
    if (date) return date;
  }
  return '';
}

function extractMetricsFromHtml(html) {
  const metrics = { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
  const sigiMatch = html.match(/<script id="SIGI_STATE">(.*?)<\/script>/);
  if (sigiMatch) {
    try {
      const data = JSON.parse(sigiMatch[1]);
      const keys = Object.keys(data?.ItemModule || {});
      if (keys.length) {
        const info = data.ItemModule[keys[0]];
        if (info?.stats) {
          metrics.views = numberOrZero(info.stats.playCount);
          metrics.likes = numberOrZero(info.stats.diggCount);
          metrics.comments = numberOrZero(info.stats.commentCount);
          metrics.saves = numberOrZero(info.stats.collectCount || info.stats.saveCount || info.stats.favoriteCount);
          metrics.shares = numberOrZero(info.stats.shareCount);
        }
        const postDate = isoDateFromEpoch(info?.createTime) || extractPostDateFromHtml(sigiMatch[1]) || '';
        return { metrics, caption: info?.desc || '', cover: info?.video?.cover || '', postDate };
      }
    } catch (error) {
      console.warn('[metrics] 解析 SIGI_STATE 失败：', error.message);
    }
  }
  const regexPick = patterns => {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return numberOrZero(match[1]);
    }
    return 0;
  };
  metrics.views =
    metrics.views ||
    regexPick([/["\\]playCount["\\]?\s*:\s*([0-9]+)/i, /play_count["\\]?\s*:\s*([0-9]+)/i]);
  metrics.likes =
    metrics.likes ||
    regexPick([/["\\]diggCount["\\]?\s*:\s*([0-9]+)/i, /like_count["\\]?\s*:\s*([0-9]+)/i]);
  metrics.comments =
    metrics.comments ||
    regexPick([/["\\]commentCount["\\]?\s*:\s*([0-9]+)/i, /comment_count["\\]?\s*:\s*([0-9]+)/i]);
  metrics.saves =
    metrics.saves ||
    regexPick([
      /["\\]collectCount["\\]?\s*:\s*([0-9]+)/i,
      /["\\]saveCount["\\]?\s*:\s*([0-9]+)/i,
      /["\\]favoriteCount["\\]?\s*:\s*([0-9]+)/i,
      /collect_count["\\]?\s*:\s*([0-9]+)/i,
      /favorite_count["\\]?\s*:\s*([0-9]+)/i
    ]);
  metrics.shares =
    metrics.shares ||
    regexPick([/["\\]shareCount["\\]?\s*:\s*([0-9]+)/i, /share_count["\\]?\s*:\s*([0-9]+)/i]);
  return { metrics, caption: '', cover: '', postDate: extractPostDateFromHtml(html) };
}

async function fetchVideoMetrics(videoLink) {
  if (!videoLink) {
    throw new Error('请提供视频链接');
  }
  let response;
  try {
    response = await fetch(videoLink, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
  } catch (error) {
    throw new Error('无法访问该视频链接');
  }
  if (!response.ok) {
    throw new Error(`视频链接返回状态 ${response.status}`);
  }
  const html = await response.text();
  const parsed = extractMetricsFromHtml(html);
  return { ...parsed, platform: detectPlatform(videoLink), fetchedAt: new Date().toISOString() };
}

function handleUnauthorized(res, message) {
  return sendJson(res, 401, { error: message || '未授权' });
}

async function refreshTrafficMetricsJob() {
  const targets = await getTrafficLogsForRefresh(100);
  if (!targets.length) {
    console.log('[cron] no traffic logs to refresh');
    return;
  }
  console.log(`[cron] refreshing traffic metrics for ${targets.length} records`);
  for (const log of targets) {
    try {
      const data = await fetchVideoMetrics(log.videoLink);
      await updateTrafficMetrics(log.id, data.metrics, data.captionDate || data.postDate);
    } catch (error) {
      console.warn(`[cron] refresh failed for ${log.id}: ${error.message}`);
    }
  }
  console.log('[cron] refresh finished');
}

function safeRefreshTrafficMetricsJob() {
  return refreshTrafficMetricsJob().catch(error => {
    console.warn('[cron] refresh job failed:', error && error.message ? error.message : error);
  });
}

function scheduleDailyRefresh() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    safeRefreshTrafficMetricsJob();
    setInterval(safeRefreshTrafficMetricsJob, 24 * 60 * 60 * 1000);
  }, delay);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readRequestBody(req);
      const username = (body.username || '').trim().toLowerCase();
      const password = (body.password || '').trim();
      if (!username || !password) {
        return sendJson(res, 400, { error: '请输入账号和密码' });
      }
      const user = await findUserByUsername(username);
      if (!user || hashPassword(password) !== user.passwordHash) {
        return sendJson(res, 401, { error: '账号或密码错误' });
      }
      const token = createSession(user);
      return sendJson(res, 200, {
        ok: true,
        token,
        user: { id: user.id, username: user.username, role: user.role }
      });
    } catch (error) {
      if (error.message === '请求体不是有效的 JSON') {
        return sendJson(res, 400, { error: 'JSON 格式错误' });
      }
      console.error('[login] error:', error);
      return sendJson(res, 500, { error: '登录失败，请稍后重试' });
    }
  }

  if (method === 'POST' && pathname === '/api/logout') {
    try {
      const { token } = authenticate(req);
      activeSessions.delete(token);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return handleUnauthorized(res, error.message);
    }
  }

  let auth;
  if (pathname.startsWith('/api/')) {
    try {
      auth = authenticate(req);
    } catch (error) {
      return handleUnauthorized(res, error.message);
    }
  }

  try {
    if (method === 'GET' && pathname === '/api/overview') {
      return sendJson(res, 200, { ok: true, data: await buildOverview() });
    }

    if (method === 'GET' && pathname === '/api/stores') {
      return sendJson(res, 200, { ok: true, stores: await getAllStores() });
    }
    if (method === 'POST' && pathname === '/api/stores') {
      const payload = await readRequestBody(req);
      const store = await createStore(payload);
      return sendJson(res, 201, { ok: true, store });
    }
    if (method === 'PUT' && pathname.startsWith('/api/stores/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      const payload = await readRequestBody(req);
      const store = await updateStore(id, payload);
      return sendJson(res, 200, { ok: true, store });
    }
    if (method === 'DELETE' && pathname.startsWith('/api/stores/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      await deleteStore(id);
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/influencers') {
      return sendJson(res, 200, { ok: true, influencers: await getAllInfluencers() });
    }
    if (method === 'POST' && pathname === '/api/influencers') {
      const payload = await readRequestBody(req);
      const influencer = await createInfluencer(payload);
      return sendJson(res, 201, { ok: true, influencer });
    }
    if (pathname.startsWith('/api/influencers/') && pathname.includes('/files')) {
      const parts = pathname.split('/').filter(Boolean);
      const influencerId = decodeURIComponent(parts[2] || '');
      const marker = parts[3] || '';
      if (marker !== 'files') {
        return sendJson(res, 404, { error: 'Not Found' });
      }
      const fileId = parts[4] ? decodeURIComponent(parts[4]) : '';
      if (method === 'GET' && !fileId) {
        const kind = (urlObj.searchParams.get('kind') || '').trim();
        const files = await listInfluencerFiles(influencerId, kind);
        return sendJson(res, 200, { ok: true, files });
      }
      if (method === 'POST' && !fileId) {
        const payload = await readRequestBody(req);
        const file = await createInfluencerFile(influencerId, payload);
        return sendJson(res, 201, { ok: true, file });
      }
      if (method === 'GET' && fileId) {
        const file = await getInfluencerFile(influencerId, fileId);
        return sendJson(res, 200, { ok: true, file });
      }
      if (method === 'DELETE' && fileId) {
        await deleteInfluencerFile(influencerId, fileId);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    if (method === 'PUT' && pathname.startsWith('/api/influencers/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      const payload = await readRequestBody(req);
      const influencer = await updateInfluencer(id, payload);
      return sendJson(res, 200, { ok: true, influencer });
    }
    if (method === 'DELETE' && pathname.startsWith('/api/influencers/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      await deleteInfluencer(id);
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/bookings') {
      const filters = {
        store: (urlObj.searchParams.get('store') || '').trim(),
        q: (urlObj.searchParams.get('q') || '').trim(),
        startDate: (urlObj.searchParams.get('startDate') || '').trim(),
        endDate: (urlObj.searchParams.get('endDate') || '').trim()
      };
      const allRecords = await getAllBookings();
      const filtered = filterBookings(allRecords, filters);
      return sendJson(res, 200, {
        ok: true,
        filters,
        records: filtered,
        summary: buildSummary(filtered),
        stores: await getStoreOptions()
      });
    }
    if (method === 'POST' && pathname === '/api/bookings') {
      const payload = await readRequestBody(req);
      if (!payload.storeId) {
        return sendJson(res, 400, { error: '请选择门店' });
      }
      if (!payload.influencerId) {
        return sendJson(res, 400, { error: '请选择达人' });
      }
      if (!payload.visitDate) {
        return sendJson(res, 400, { error: '请填写到访日期' });
      }
      const record = await createBooking(payload);
      const allRecords = await getAllBookings();
      return sendJson(res, 201, {
        ok: true,
        record,
        summary: buildSummary(allRecords)
      });
    }
    if (method === 'PUT' && pathname.startsWith('/api/bookings/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      const payload = await readRequestBody(req);
      const record = await updateBooking(id, payload);
      const allRecords = await getAllBookings();
      return sendJson(res, 200, {
        ok: true,
        record,
        summary: buildSummary(allRecords)
      });
    }
    if (method === 'DELETE' && pathname.startsWith('/api/bookings/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      await deleteBooking(id);
      const allRecords = await getAllBookings();
      return sendJson(res, 200, {
        ok: true,
        summary: buildSummary(allRecords)
      });
    }

    if (method === 'GET' && pathname === '/api/traffic') {
      return sendJson(res, 200, { ok: true, logs: await getAllTrafficLogs() });
    }
    if (method === 'POST' && pathname === '/api/traffic') {
      const payload = await readRequestBody(req);
      const log = await createTrafficLog(payload);
      return sendJson(res, 201, { ok: true, log });
    }
    if (method === 'PUT' && pathname.startsWith('/api/traffic/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      const payload = await readRequestBody(req);
      const log = await updateTrafficLog(id, payload);
      return sendJson(res, 200, { ok: true, log });
    }
    if (method === 'POST' && pathname === '/api/traffic/fetch') {
      const payload = await readRequestBody(req);
      const data = await fetchVideoMetrics(payload.videoLink);
      return sendJson(res, 200, { ok: true, data });
    }

    if (method === 'GET' && pathname === '/api/users') {
      return sendJson(res, 200, { ok: true, users: await getAllUsers() });
    }
    if (method === 'POST' && pathname === '/api/users') {
      const payload = await readRequestBody(req);
      const user = await createUser(payload);
      return sendJson(res, 201, { ok: true, user });
    }
    if (method === 'PUT' && pathname.startsWith('/api/users/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      const payload = await readRequestBody(req);
      const user = await updateUserPassword(id, payload.password);
      return sendJson(res, 200, { ok: true, user });
    }
  } catch (error) {
    if (error.statusCode === 401) {
      return handleUnauthorized(res, error.message);
    }
    if (error.message === '请求体不是有效的 JSON') {
      return sendJson(res, 400, { error: 'JSON 格式错误' });
    }
    if (error.message === '请求体过大') {
      return sendJson(res, 413, { error: '请求体过大' });
    }
    console.error('[api] error:', error);
    return sendJson(res, 500, { error: error.message || '服务器内部错误' });
  }

  if (method === 'GET') {
    if (tryServeStatic(req, res)) {
      return;
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function tryServeStatic(req, res) {
  const rawPath = req.url.split('?')[0];
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  const normalizedPath = path.normalize(relativePath);
  const filePath = path.join(__dirname, normalizedPath);
  const relativeToRoot = path.relative(__dirname, filePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, ...CORS_HEADERS });
  res.end(content);
  return true;
}

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  scheduleDailyRefresh();
});
