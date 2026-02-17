import type { RequestEvent } from './aggregator';

// Nginx combined log format:
// $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time $host
// Example: 1.2.3.4 - - [17/Feb/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "curl/7.68.0" 0.001 portal.davidfdzmorilla.dev

export function parseLogLine(line: string): RequestEvent | null {
  // Match nginx combined format with request_time and host appended
  const combined = line.match(
    /^(\S+) - \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) \d+ "[^"]*" "[^"]*"(?: ([\d.]+))?(?: (\S+))?/
  );

  if (!combined) return null;

  const [, ip, , method, path, statusStr, responseTimeStr, host] = combined;
  const status = parseInt(statusStr, 10);
  const responseMs = responseTimeStr ? Math.round(parseFloat(responseTimeStr) * 1000) : 0;
  const service = host || 'unknown';

  if (isNaN(status)) return null;

  return {
    timestamp: Date.now(),
    service: service.replace('.davidfdzmorilla.dev', ''),
    path: path.split('?')[0].substring(0, 100),
    method,
    status,
    responseMs,
    ip,
  };
}
