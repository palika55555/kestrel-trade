import fs from 'fs';

export type AuditAction =
  | 'BOT_CONFIG_UPDATE'
  | 'BOT_ENABLED'
  | 'BOT_DISABLED'
  | 'BOT_CLOSE_ALL'
  | 'BOT_CLOSE_POSITION'
  | 'BOT_POSITION_RISK'
  | 'BOT_RESET'
  | 'BROKER_ROUTING_ARMED'
  | 'BROKER_ROUTING_DISARMED'
  | 'BROKER_ARM_REFUSED'
  | 'BROKER_SYNC'
  | 'BROKER_CONNECT_START'
  | 'BROKER_CONNECTED'
  | 'BROKER_CONNECT_FAILED'
  | 'REQUEST_REJECTED';

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: AuditAction;
  summary: string;
  changes?: Record<string, {from: unknown; to: unknown}>;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditRequestInfo {
  ip: string | null;
  userAgent: string | null;
}

const MAX_IN_MEMORY = 500;
// Caps keep attacker-controlled text (URLs, user agents) from bloating the file.
const MAX_TEXT_LENGTH = 300;
// The active file is rotated to <file>.1 at startup once it grows past this size.
export const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;

function truncate(value: string | null): string | null {
  if (value === null || value.length <= MAX_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_LENGTH)}…`;
}

// Append-only audit trail: one JSON object per line on disk, newest entries cached in memory.
export class AuditLog {
  private filePath: string;
  private entries: AuditEntry[] = [];
  private writeFailing = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.rotateIfLarge();
    this.entries = this.loadTail();
  }

  record(
    action: AuditAction,
    summary: string,
    request: AuditRequestInfo,
    changes?: AuditEntry['changes'],
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      action,
      summary: truncate(summary) ?? '',
      ...(changes && Object.keys(changes).length > 0 ? {changes} : {}),
      ip: truncate(request.ip),
      userAgent: truncate(request.userAgent),
    };
    this.entries = [entry, ...this.entries].slice(0, MAX_IN_MEMORY);
    this.append(entry);
    return entry;
  }

  list(limit = 100): AuditEntry[] {
    const n = Math.max(1, Math.min(MAX_IN_MEMORY, Math.floor(limit)));
    return this.entries.slice(0, n);
  }

  private append(entry: AuditEntry) {
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      this.writeFailing = false;
    } catch (err) {
      if (!this.writeFailing) {
        this.writeFailing = true;
        console.error(`[audit] Failed to write audit log ${this.filePath}:`, err);
      }
    }
  }

  private rotateIfLarge() {
    try {
      if (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > MAX_AUDIT_FILE_BYTES) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
        console.info(`[audit] Rotated ${this.filePath} to ${this.filePath}.1`);
      }
    } catch (err) {
      console.error(`[audit] Could not rotate audit log ${this.filePath}:`, err);
    }
  }

  private loadTail(): AuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
      const parsed: AuditEntry[] = [];
      for (const line of lines.slice(-MAX_IN_MEMORY)) {
        try {
          parsed.push(JSON.parse(line) as AuditEntry);
        } catch {
          console.warn('[audit] Skipping unreadable audit log line.');
        }
      }
      return parsed.reverse();
    } catch (err) {
      console.error(`[audit] Could not read audit log ${this.filePath}:`, err);
      return [];
    }
  }
}

// Field-level diff of the keys present in `next`, used to record exactly what a config change touched.
export function diffChanges<T extends object>(
  prev: T,
  next: Partial<T>,
): Record<string, {from: unknown; to: unknown}> {
  const changes: Record<string, {from: unknown; to: unknown}> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    const from = prev[key];
    const to = next[key];
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) {
      changes[String(key)] = {from, to};
    }
  }
  return changes;
}
