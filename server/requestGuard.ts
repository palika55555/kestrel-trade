import type express from 'express';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Hostnames the API answers to: loopback plus anything listed in ALLOWED_HOSTS (comma separated),
// e.g. the LAN IP when running with HOST=0.0.0.0.
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...LOOPBACK_HOSTS, ...extra];
}

function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

export interface GuardInput {
  method: string;
  host: string | undefined;
  origin: string | undefined;
}

export type GuardVerdict = {ok: true} | {ok: false; reason: string};

// Blocks DNS-rebinding (unknown Host header) and cross-site writes (foreign Origin on a POST),
// so a random web page cannot drive the local bot through the user's browser.
export function checkRequest(input: GuardInput, allowedHosts: string[]): GuardVerdict {
  if (!input.host) return {ok: false, reason: 'missing Host header'};
  const hostname = hostnameOf(input.host);
  if (!allowedHosts.includes(hostname)) return {ok: false, reason: `host ${hostname} not allowed`};
  if (SAFE_METHODS.has(input.method.toUpperCase()) || !input.origin) return {ok: true};
  let originHost: string;
  try {
    originHost = new URL(input.origin).host.toLowerCase();
  } catch {
    return {ok: false, reason: 'malformed Origin header'};
  }
  if (originHost !== input.host.trim().toLowerCase()) {
    return {ok: false, reason: `cross-origin request from ${input.origin}`};
  }
  return {ok: true};
}

export function createRequestGuard(
  allowedHosts: string[],
  onReject: (req: express.Request, reason: string) => void,
): express.RequestHandler {
  return (req, res, next) => {
    const verdict = checkRequest(
      {method: req.method, host: req.get('host'), origin: req.get('origin')},
      allowedHosts,
    );
    if (verdict.ok) {
      next();
      return;
    }
    onReject(req, verdict.reason);
    res.status(403).json({error: 'Forbidden', details: [verdict.reason]});
  };
}
