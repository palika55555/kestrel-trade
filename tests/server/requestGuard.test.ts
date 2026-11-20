import {describe, expect, it} from 'vitest';
import {allowedHostsFromEnv, checkRequest} from '../../server/requestGuard.ts';

const ALLOWED = allowedHostsFromEnv({});

describe('checkRequest', () => {
  it('accepts loopback hosts with any port', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) {
      expect(checkRequest({method: 'GET', host, origin: undefined}, ALLOWED)).toEqual({ok: true});
    }
  });

  it('rejects unknown hosts (DNS rebinding) even for GET', () => {
    const verdict = checkRequest({method: 'GET', host: 'attacker.example:3000', origin: undefined}, ALLOWED);
    expect(verdict.ok).toBe(false);
    expect(checkRequest({method: 'GET', host: undefined, origin: undefined}, ALLOWED).ok).toBe(false);
  });

  it('rejects writes whose Origin differs from the Host', () => {
    const verdict = checkRequest(
      {method: 'POST', host: 'localhost:3000', origin: 'https://evil.example'},
      ALLOWED,
    );
    expect(verdict).toEqual({ok: false, reason: 'cross-origin request from https://evil.example'});
    expect(checkRequest({method: 'POST', host: 'localhost:3000', origin: 'not a url'}, ALLOWED).ok).toBe(false);
    expect(checkRequest({method: 'POST', host: 'localhost:3000', origin: 'http://localhost:3001'}, ALLOWED).ok).toBe(false);
  });

  it('allows same-origin writes and writes without Origin (curl, scripts)', () => {
    expect(checkRequest({method: 'POST', host: 'localhost:3000', origin: 'http://localhost:3000'}, ALLOWED).ok).toBe(true);
    expect(checkRequest({method: 'POST', host: 'localhost:3000', origin: undefined}, ALLOWED).ok).toBe(true);
  });

  it('adds hosts from ALLOWED_HOSTS', () => {
    const hosts = allowedHostsFromEnv({ALLOWED_HOSTS: '192.168.1.20, Trader-PC '});
    expect(checkRequest({method: 'GET', host: '192.168.1.20:3000', origin: undefined}, hosts).ok).toBe(true);
    expect(checkRequest({method: 'GET', host: 'trader-pc:3000', origin: undefined}, hosts).ok).toBe(true);
  });
});
