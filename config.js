const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 8787;

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const sep = line.indexOf('=');
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      if (!key) continue;
      if (process.env[key]) continue;
      const value = line.slice(sep + 1).trim();
      const unquoted = value.replace(/^['"]|['"]$/g, '');
      process.env[key] = unquoted;
    }
  } catch (error) {
    console.warn('[config] 无法读取 .env，已忽略：', error.message);
  }
}

loadDotEnv();

function loadLocalConfig() {
  const configPath = path.join(__dirname, 'app.config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[config] 无法解析 app.config.json，已忽略该文件:', error.message);
    return {};
  }
}

const localConfig = loadLocalConfig();

function pickNumber(key, fallback) {
  const envValue = process.env[key];
  if (envValue && !Number.isNaN(Number(envValue))) {
    return Number(envValue);
  }
  const localValue = localConfig[key];
  if (typeof localValue === 'number' && Number.isFinite(localValue)) {
    return localValue;
  }
  return fallback;
}

function pickString(key, fallback = '') {
  const envValue = process.env[key];
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }
  const localValue = localConfig[key];
  if (typeof localValue === 'string' && localValue.trim()) {
    return localValue.trim();
  }
  return fallback;
}

function pickBoolean(key, fallback = false) {
  const envValue = process.env[key];
  if (typeof envValue === 'string' && envValue.trim()) {
    const normalized = envValue.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  const localValue = localConfig[key];
  if (typeof localValue === 'boolean') return localValue;
  return fallback;
}

const config = {
  PORT: pickNumber('PORT', DEFAULT_PORT),
  DB_DRIVER: pickString('DB_DRIVER', 'sqlite'),
  DATABASE_URL: pickString('DATABASE_URL', ''),
  PG_SSL: pickBoolean('PG_SSL', false),
  PG_POOL_MAX: pickNumber('PG_POOL_MAX', 10),
  MAX_BODY_BYTES: pickNumber('MAX_BODY_BYTES', 30 * 1024 * 1024)
};

module.exports = config;
