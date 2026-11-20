import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

// Project root (this file lives in <root>/server/).
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = Number(process.env.PORT || 3000);
// Local-only by default; set HOST=0.0.0.0 to reach the app from other devices on the LAN.
export const HOST = process.env.HOST || '127.0.0.1';
export const distPath = path.resolve(ROOT_DIR, 'dist');
export const hasBuiltDist = fs.existsSync(path.join(distPath, 'index.html'));
export const useViteDev =
  process.env.NODE_ENV !== 'production' &&
  (!hasBuiltDist || process.env.npm_lifecycle_event === 'dev');

export const SERVER_BOOT_ID = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
// Bot state and the audit log live on local disk (default ./data, override with KESTREL_DATA_DIR).
export const SERVER_DATA_DIR = path.resolve(process.env.KESTREL_DATA_DIR || path.join(ROOT_DIR, 'data'));
export let HAS_PERSISTENT_VOLUME = true;
try {
  fs.mkdirSync(SERVER_DATA_DIR, {recursive: true});
} catch (err) {
  HAS_PERSISTENT_VOLUME = false;
  console.error(`[boot] Cannot create data dir ${SERVER_DATA_DIR}; bot state will not be saved:`, err);
}
export const SERVER_BOT_STATE_PATH = path.join(SERVER_DATA_DIR, '.kestrel-server-bot.json');
export const AUDIT_LOG_PATH = path.join(SERVER_DATA_DIR, 'audit-log.jsonl');
