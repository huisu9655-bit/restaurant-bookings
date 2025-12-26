const fs = require('fs');
const path = require('path');

const sqliteStore = require('../sqliteStore');

function main() {
  const outArg = process.argv[2];
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(__dirname, '..', 'data', 'bookings.json');

  const payload = {
    stores: sqliteStore.getAllStores(),
    influencers: sqliteStore.getAllInfluencers(),
    bookings: sqliteStore.getAllBookings(),
    trafficLogs: sqliteStore.getAllTrafficLogs().map(log => ({
      ...log,
      metrics: { ...(log.metrics || {}), saves: Number(log.metrics?.saves || 0) }
    }))
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[export] 已导出 ${payload.bookings.length} 条预约、${payload.trafficLogs.length} 条流量到：${outPath}`);
}

main();

