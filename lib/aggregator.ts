export interface RequestEvent {
  timestamp: number;
  service: string;    // from Host header
  path: string;
  method: string;
  status: number;
  responseMs: number;
  ip: string;
}

interface WindowStats {
  total: number;
  errors: number;
  totalMs: number;
  paths: Map<string, number>;
  services: Map<string, number>;
  statuses: Map<number, number>;
}

const WINDOW_MS = 60 * 1000; // 1 minute rolling window

class RollingAggregator {
  private events: Array<RequestEvent & { ts: number }> = [];

  add(event: RequestEvent) {
    this.events.push({ ...event, ts: Date.now() });
    this.prune();
  }

  private prune() {
    const cutoff = Date.now() - WINDOW_MS;
    this.events = this.events.filter(e => e.ts > cutoff);
  }

  getStats(): WindowStats & { rps: number; errorRate: number; p99Ms: number } {
    this.prune();
    const stats: WindowStats = {
      total: this.events.length,
      errors: 0,
      totalMs: 0,
      paths: new Map(),
      services: new Map(),
      statuses: new Map(),
    };

    const latencies: number[] = [];
    for (const e of this.events) {
      if (e.status >= 400) stats.errors++;
      stats.totalMs += e.responseMs;
      latencies.push(e.responseMs);
      stats.paths.set(e.path, (stats.paths.get(e.path) || 0) + 1);
      stats.services.set(e.service, (stats.services.get(e.service) || 0) + 1);
      stats.statuses.set(e.status, (stats.statuses.get(e.status) || 0) + 1);
    }

    latencies.sort((a, b) => a - b);
    const p99Ms = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;
    const rps = stats.total / (WINDOW_MS / 1000);
    const errorRate = stats.total > 0 ? (stats.errors / stats.total) * 100 : 0;

    return { ...stats, rps, errorRate, p99Ms };
  }

  getTopPaths(n = 10): Array<{ path: string; count: number }> {
    const stats = this.getStats();
    return Array.from(stats.paths.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([path, count]) => ({ path, count }));
  }

  getTopServices(n = 10): Array<{ service: string; count: number }> {
    const stats = this.getStats();
    return Array.from(stats.services.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([service, count]) => ({ service, count }));
  }

  getRecentEvents(n = 20): RequestEvent[] {
    return this.events.slice(-n).reverse();
  }
}

export const aggregator = new RollingAggregator();
