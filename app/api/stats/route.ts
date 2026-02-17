import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { getDb } from '@/lib/db';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
const STATS_KEY = 'platform:stats';

export async function GET() {
  const redis = new Redis(REDIS_URL);
  redis.on('error', () => {});

  try {
    const raw = await redis.get(STATS_KEY);
    const current = raw ? JSON.parse(raw) : {
      rps: 0, errorRate: 0, total: 0, errors: 0, p99Ms: 0, avgMs: 0,
    };

    const db = getDb();
    const historical = db.prepare(`
      SELECT hour, SUM(total_requests) as total, SUM(error_count) as errors
      FROM hourly_aggregates
      WHERE hour >= datetime('now', '-24 hours', 'start of hour')
      GROUP BY hour ORDER BY hour DESC LIMIT 24
    `).all();

    return NextResponse.json({
      current: {
        rps: current.rps ?? 0,
        errorRate: current.errorRate ?? 0,
        total: current.total ?? 0,
        errors: current.errors ?? 0,
        p99Ms: current.p99Ms ?? 0,
      },
      topPaths: current.topPaths ?? [],
      topServices: current.topServices ?? [],
      historical,
    });
  } finally {
    redis.disconnect();
  }
}
