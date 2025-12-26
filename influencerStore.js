const config = require('./config');

function shouldUsePostgres() {
  const driverRaw = String(config.DB_DRIVER || '').trim().toLowerCase();
  const hasUrl = Boolean(String(config.DATABASE_URL || '').trim());
  if (driverRaw === 'postgres' || driverRaw === 'postgresql') return true;
  if (driverRaw === 'sqlite') return false;
  return hasUrl;
}

module.exports = shouldUsePostgres() ? require('./postgresStore') : require('./sqliteStore');

