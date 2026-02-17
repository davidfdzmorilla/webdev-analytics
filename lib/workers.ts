import fs from 'fs';
import Redis from 'ioredis';
import { parseLogLine } from './logParser';
import { aggregator } from './aggregator';
import { getDb } from './db';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
const LOG_PATH = process.env.LOG_PATH || '/var/log/nginx/access.log';
const STREAM_KEY = 'platform:requests';
export const STATS_KEY = 'platform:stats';
export const EVENTS_KEY = 'platform:events';

let workersStarted = false;

async function ensureStreamGroup(redis: Redis) {
  // Allow writes on replica if needed
  await redis.config('SET', 'replica-read-only', 'no').catch(() => {});
  try {
    await redis.xgroup('CREATE', STREAM_KEY, 'analytics-processor', '0', 'MKSTREAM');
  } catch (e: unknown) {
    if (!(e instanceof Error) || !e.message.includes('BUSYGROUP')) throw e;
  }
}

async function startLogTailer(redis: Redis) {
  const LOG_AVAILABLE = fs.existsSync(LOG_PATH);
  if (!LOG_AVAILABLE) {
    console.log(`[analytics] Log file not found: ${LOG_PATH} — generating synthetic data`);
    const services = ['portal', 'gateway', 'observe', 'loadtest', 'workflows'];
    const paths = ['/', '/api/health', '/api/status', '/api/routes', '/api/runs'];
    setInterval(async () => {
      for (let i = 0; i < Math.floor(Math.random() * 5) + 1; i++) {
        const event = {
          timestamp: Date.now(),
          service: services[Math.floor(Math.random() * services.length)],
          path: paths[Math.floor(Math.random() * paths.length)],
          method: 'GET',
          status: Math.random() > 0.05 ? 200 : 500,
          responseMs: Math.floor(Math.random() * 50) + 1,
          ip: '10.0.0.1',
        };
        aggregator.add(event);
        await redis.xadd(STREAM_KEY, '*',
          'service', event.service, 'path', event.path, 'method', event.method,
          'status', String(event.status), 'responseMs', String(event.responseMs),
          'ip', event.ip
        ).catch(() => {});
      }
    }, 1000);
    return;
  }

  // Tail real log file
  let fileSize = fs.statSync(LOG_PATH).size;
  const fd = fs.openSync(LOG_PATH, 'r');
  let position = fileSize;

  const tail = () => {
    try {
      const newSize = fs.statSync(LOG_PATH).size;
      if (newSize < fileSize) {
        position = 0;
        fileSize = newSize;
      }
      if (newSize > position) {
        const bufSize = newSize - position;
        const buf = Buffer.alloc(bufSize);
        fs.readSync(fd, buf, 0, bufSize, position);
        position = newSize;
        fileSize = newSize;

        const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
        for (const line of lines) {
          const event = parseLogLine(line);
          if (event) {
            aggregator.add(event);
            redis.xadd(STREAM_KEY, '*',
              'service', event.service, 'path', event.path, 'method', event.method,
              'status', String(event.status), 'responseMs', String(event.responseMs),
              'ip', event.ip
            ).catch(() => {});
          }
        }
      }
    } catch {
      // ignore errors
    }
  };

  setInterval(tail, 500);
  console.log('[analytics] Log tailer started');
}

async function startStatsPublisher(redis: Redis) {
  const publish = async () => {
    try {
      const stats = aggregator.getStats();
      const payload = {
        rps: Math.round(stats.rps * 100) / 100,
        errorRate: Math.round(stats.errorRate * 10) / 10,
        p99Ms: stats.p99Ms,
        avgMs: stats.total > 0 ? Math.round(stats.totalMs / stats.total) : 0,
        total: stats.total,
        errors: stats.errors,
        topPaths: aggregator.getTopPaths(5),
        topServices: aggregator.getTopServices(5),
        recentEvents: aggregator.getRecentEvents(10),
        timestamp: Date.now(),
      };
      await redis.set(STATS_KEY, JSON.stringify(payload), 'EX', 120);
    } catch {
      // ignore
    }
  };

  await publish();
  setInterval(publish, 2000);
  console.log('[analytics] Stats publisher started');
}

async function startHourlySnapshot() {
  const snapshot = () => {
    try {
      const db = getDb();
      const stats = aggregator.getStats();
      const services = aggregator.getTopServices(20);
      const hour = new Date().toISOString().substring(0, 13);

      for (const { service, count } of services) {
        db.prepare(`
          INSERT INTO hourly_aggregates (hour, service, total_requests, error_count, avg_response_ms)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(hour, service) DO UPDATE SET
            total_requests = total_requests + excluded.total_requests,
            error_count = error_count + excluded.error_count
        `).run(hour, service, count, Math.floor(stats.errors * count / (stats.total || 1)),
          stats.totalMs / (stats.total || 1));
      }
    } catch {
      // ignore
    }
  };

  setInterval(snapshot, 60000);
  console.log('[analytics] Hourly snapshot scheduler started');
}

export async function startWorkers() {
  if (workersStarted) return;
  workersStarted = true;

  const redis = new Redis(REDIS_URL);
  redis.on('error', (e) => console.error('[analytics] Redis error:', e.message));

  await ensureStreamGroup(redis).catch(e => console.warn('[analytics] Stream group:', e.message));
  await startLogTailer(redis);
  await startStatsPublisher(redis);
  await startHourlySnapshot();

  console.log('[analytics] All workers started');
}
