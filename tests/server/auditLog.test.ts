import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AuditLog, MAX_AUDIT_FILE_BYTES, diffChanges} from '../../server/auditLog.ts';

const REQ = {ip: '127.0.0.1', userAgent: 'vitest'};

describe('AuditLog', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-audit-'));
    file = path.join(dir, 'audit-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('lists newest entries first and appends one JSON line per entry', () => {
    const log = new AuditLog(file);
    log.record('BOT_ENABLED', 'started', REQ);
    log.record('BOT_DISABLED', 'paused', REQ);

    expect(log.list().map((e) => e.action)).toEqual(['BOT_DISABLED', 'BOT_ENABLED']);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({action: 'BOT_ENABLED', ip: '127.0.0.1'});
  });

  it('reloads history from disk after a restart', () => {
    new AuditLog(file).record('BOT_RESET', 'reset', REQ);
    const reopened = new AuditLog(file);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0].summary).toBe('reset');
  });

  it('skips corrupt lines instead of failing to start', () => {
    fs.writeFileSync(file, '{not json}\n' + JSON.stringify({id: 'a', action: 'BOT_RESET', summary: 'ok'}) + '\n');
    const log = new AuditLog(file);
    expect(log.list().map((e) => e.id)).toEqual(['a']);
  });

  it('omits empty change sets and clamps list limits', () => {
    const log = new AuditLog(file);
    const entry = log.record('BROKER_SYNC', 'sync', REQ, {});
    expect(entry.changes).toBeUndefined();
    for (let i = 0; i < 5; i++) log.record('BROKER_SYNC', `s${i}`, REQ);
    expect(log.list(2)).toHaveLength(2);
    expect(log.list(0)).toHaveLength(1);
  });

  it('keeps working in memory when the file cannot be written', () => {
    const log = new AuditLog(path.join(dir, 'missing-dir', 'audit.jsonl'));
    log.record('BOT_ENABLED', 'started', REQ);
    expect(log.list()).toHaveLength(1);
  });
});

describe('diffChanges', () => {
  it('reports only keys whose value actually changed', () => {
    const prev = {lotSize: 0.1, leverage: 15, trailingStopDollars: null as number | null};
    expect(diffChanges(prev, {lotSize: 0.5, leverage: 15, trailingStopDollars: 2})).toEqual({
      lotSize: {from: 0.1, to: 0.5},
      trailingStopDollars: {from: null, to: 2},
    });
  });

  it('returns an empty object when nothing changed', () => {
    expect(diffChanges({a: 1}, {a: 1})).toEqual({});
  });
});

describe('AuditLog limits', () => {
  it('truncates long summaries and user agents', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-audit-'));
    try {
      const log = new AuditLog(path.join(dir, 'a.jsonl'));
      const entry = log.record('REQUEST_REJECTED', 'x'.repeat(5000), {ip: '1.2.3.4', userAgent: 'u'.repeat(5000)});
      expect(entry.summary.length).toBeLessThanOrEqual(301);
      expect(entry.userAgent!.length).toBeLessThanOrEqual(301);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('rotates an oversized file at startup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-audit-'));
    try {
      const file = path.join(dir, 'a.jsonl');
      fs.writeFileSync(file, 'x'.repeat(MAX_AUDIT_FILE_BYTES + 1));
      const log = new AuditLog(file);
      expect(fs.existsSync(`${file}.1`)).toBe(true);
      expect(log.list()).toHaveLength(0);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
