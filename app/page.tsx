'use client';

import { useEffect, useState } from 'react';

interface RequestEvent {
  timestamp: number;
  service: string;
  path: string;
  method: string;
  status: number;
  responseMs: number;
  ip: string;
}

interface TopItem {
  path?: string;
  service?: string;
  count: number;
}

interface StreamData {
  rps: number;
  errorRate: number;
  p99Ms: number;
  avgMs: number;
  total: number;
  errors: number;
  topPaths: TopItem[];
  topServices: TopItem[];
  recentEvents: RequestEvent[];
  timestamp: number;
}

function StatusBadge({ status }: { status: number }) {
  const color =
    status < 300
      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
      : status < 400
      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
      : 'bg-red-500/20 text-red-400 border border-red-500/30';
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${color}`}>{status}</span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'text-blue-400',
    POST: 'text-green-400',
    PUT: 'text-yellow-400',
    PATCH: 'text-orange-400',
    DELETE: 'text-red-400',
  };
  return (
    <span className={`text-xs font-mono font-bold w-12 inline-block ${colors[method] || 'text-gray-400'}`}>
      {method}
    </span>
  );
}

function BarChart({ items, labelKey }: { items: TopItem[]; labelKey: 'path' | 'service' }) {
  const max = items[0]?.count || 1;
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const label = labelKey === 'path' ? item.path! : item.service!;
        const pct = Math.round((item.count / max) * 100);
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono w-32 truncate shrink-0" title={label}>
              {label}
            </span>
            <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden">
              <div
                className="h-full bg-indigo-500/70 rounded transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-gray-300 font-mono w-8 text-right shrink-0">
              {item.count}
            </span>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-xs text-gray-600 italic">Waiting for data…</p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<StreamData | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const parsed = JSON.parse(e.data) as StreamData;
      setData(parsed);
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => es.close();
  }, []);

  const now = new Date().toLocaleTimeString();

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Platform Analytics Stream
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time nginx access log pipeline · 1-minute rolling window
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full transition-colors ${
              connected ? 'bg-emerald-400 animate-ping' : 'bg-red-500'
            }`}
          />
          <span className={`text-sm font-medium ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
            {connected ? '⚡ Live' : '○ Disconnected'}
          </span>
          <span className="text-xs text-gray-600 ml-2">{now}</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Req / sec',
            value: data?.rps.toFixed(2) ?? '—',
            sub: 'over last 60s',
            color: 'text-indigo-400',
          },
          {
            label: 'Error Rate',
            value: data ? `${data.errorRate.toFixed(1)}%` : '—',
            sub: `${data?.errors ?? 0} errors`,
            color: data && data.errorRate > 5 ? 'text-red-400' : 'text-emerald-400',
          },
          {
            label: 'p99 Latency',
            value: data ? `${data.p99Ms}ms` : '—',
            sub: `avg ${data?.avgMs ?? 0}ms`,
            color: data && data.p99Ms > 500 ? 'text-yellow-400' : 'text-blue-400',
          },
          {
            label: 'Total Requests',
            value: data?.total.toLocaleString() ?? '—',
            sub: 'in window',
            color: 'text-purple-400',
          },
        ].map(({ label, value, sub, color }) => (
          <div
            key={label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-1"
          >
            <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
            <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
            <span className="text-xs text-gray-600">{sub}</span>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
            Top Services
          </h2>
          <BarChart items={data?.topServices ?? []} labelKey="service" />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
            Top Paths
          </h2>
          <BarChart items={data?.topPaths ?? []} labelKey="path" />
        </div>
      </div>

      {/* Recent Events */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
          Recent Events
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase border-b border-gray-800">
                <th className="text-left pb-2 pr-4">Method</th>
                <th className="text-left pb-2 pr-4">Path</th>
                <th className="text-left pb-2 pr-4">Status</th>
                <th className="text-left pb-2 pr-4">Service</th>
                <th className="text-right pb-2">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {(data?.recentEvents ?? []).map((ev, i) => (
                <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2 pr-4">
                    <MethodBadge method={ev.method} />
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-300 max-w-xs truncate">
                    {ev.path}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={ev.status} />
                  </td>
                  <td className="py-2 pr-4 text-xs text-indigo-400 font-medium">{ev.service}</td>
                  <td className="py-2 text-right text-xs font-mono text-gray-400">
                    {ev.responseMs}ms
                  </td>
                </tr>
              ))}
              {(!data || data.recentEvents.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-xs text-gray-600 italic">
                    Waiting for events…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-xs text-gray-700">
        analytics.davidfdzmorilla.dev · nginx → Redis Streams → SSE · Last update:{' '}
        {data ? new Date(data.timestamp).toLocaleTimeString() : '—'}
      </div>

    </main>
  );
}
