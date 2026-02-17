import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
const STATS_KEY = 'platform:stats';

export async function GET() {
  const encoder = new TextEncoder();
  const redis = new Redis(REDIS_URL);
  redis.on('error', () => {}); // suppress errors

  const stream = new ReadableStream({
    start(controller) {
      const send = async () => {
        try {
          const raw = await redis.get(STATS_KEY);
          if (raw) {
            controller.enqueue(encoder.encode(`data: ${raw}\n\n`));
          } else {
            // No data yet - send empty payload
            const empty = JSON.stringify({
              rps: 0, errorRate: 0, p99Ms: 0, avgMs: 0,
              total: 0, errors: 0, topPaths: [], topServices: [],
              recentEvents: [], timestamp: Date.now(),
            });
            controller.enqueue(encoder.encode(`data: ${empty}\n\n`));
          }
        } catch {
          clearInterval(interval);
          redis.disconnect();
          controller.close();
        }
      };

      send();
      const interval = setInterval(send, 2000);

      return () => {
        clearInterval(interval);
        redis.disconnect();
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
