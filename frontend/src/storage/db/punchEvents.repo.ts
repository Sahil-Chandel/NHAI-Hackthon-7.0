import {getDb} from './dbClient';

export type PunchType = 'in' | 'out';

export type PunchEventRow = {
  id: string;
  workerId: string;
  type: PunchType;
  timestamp: number; // unix ms
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAccuracy: number | null;
  faceMatchScore: number | null;
  livenessPassed: boolean;
  deviceId: string | null;
  synced: boolean;
  syncAttempts: number;
  lastSyncError: string | null;
  createdAt: number;
};

function generateId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}

export type InsertPunchInput = {
  workerId: string;
  type: PunchType;
  timestamp?: number;
  gpsLat?: number | null;
  gpsLon?: number | null;
  gpsAccuracy?: number | null;
  faceMatchScore?: number | null;
  livenessPassed?: boolean;
  deviceId?: string | null;
};

export function insertPunchEvent(input: InsertPunchInput): PunchEventRow {
  const db = getDb();
  const id = generateId();
  const ts = input.timestamp ?? Date.now();
  db.execute(
    `INSERT INTO punch_events
     (id, worker_id, type, timestamp, gps_lat, gps_lon, gps_accuracy, face_match_score, liveness_passed, device_id, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      input.workerId,
      input.type,
      ts,
      input.gpsLat ?? null,
      input.gpsLon ?? null,
      input.gpsAccuracy ?? null,
      input.faceMatchScore ?? null,
      input.livenessPassed === false ? 0 : 1,
      input.deviceId ?? null,
    ],
  );
  return {
    id,
    workerId: input.workerId,
    type: input.type,
    timestamp: ts,
    gpsLat: input.gpsLat ?? null,
    gpsLon: input.gpsLon ?? null,
    gpsAccuracy: input.gpsAccuracy ?? null,
    faceMatchScore: input.faceMatchScore ?? null,
    livenessPassed: input.livenessPassed !== false,
    deviceId: input.deviceId ?? null,
    synced: false,
    syncAttempts: 0,
    lastSyncError: null,
    createdAt: ts,
  };
}

function rowToObj(row: any): PunchEventRow {
  return {
    id: row.id,
    workerId: row.worker_id,
    type: row.type,
    timestamp: row.timestamp,
    gpsLat: row.gps_lat,
    gpsLon: row.gps_lon,
    gpsAccuracy: row.gps_accuracy,
    faceMatchScore: row.face_match_score,
    livenessPassed: !!row.liveness_passed,
    deviceId: row.device_id,
    synced: !!row.synced,
    syncAttempts: row.sync_attempts ?? 0,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at * 1000,
  };
}

export function getTodayEvents(
  workerId: string,
  now: number = Date.now(),
): PunchEventRow[] {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Use date arithmetic instead of fixed `+ 24h` so DST transitions (where a
  // day is 23 or 25 hours) don't slice off / double-count events. India
  // doesn't currently observe DST, but the calendar API handles both cases
  // correctly for free.
  const end = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + 1,
  ).getTime();
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM punch_events
     WHERE worker_id = ? AND timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [workerId, start, end],
  );
  const rows: PunchEventRow[] = [];
  if (result.rows) {
    for (let i = 0; i < result.rows.length; i++) {
      rows.push(rowToObj(result.rows.item(i)));
    }
  }
  return rows;
}

export function getEventsBetween(
  workerId: string,
  fromMs: number,
  toMs: number,
): PunchEventRow[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM punch_events
     WHERE worker_id = ? AND timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [workerId, fromMs, toMs],
  );
  const rows: PunchEventRow[] = [];
  if (result.rows) {
    for (let i = 0; i < result.rows.length; i++) {
      rows.push(rowToObj(result.rows.item(i)));
    }
  }
  return rows;
}

// After this many sync failures, stop auto-retrying an event — it will sit in
// the local DB awaiting manual intervention so the sync loop doesn't churn on
// it forever (e.g. a permanently-malformed row that the backend keeps
// rejecting).
const MAX_SYNC_ATTEMPTS = 10;

export function getUnsyncedEvents(limit = 50): PunchEventRow[] {
  const db = getDb();
  const result = db.execute(
    `SELECT * FROM punch_events
     WHERE synced = 0 AND sync_attempts < ?
     ORDER BY timestamp ASC LIMIT ?`,
    [MAX_SYNC_ATTEMPTS, limit],
  );
  const rows: PunchEventRow[] = [];
  if (result.rows) {
    for (let i = 0; i < result.rows.length; i++) {
      rows.push(rowToObj(result.rows.item(i)));
    }
  }
  return rows;
}

export function getUnsyncedCount(): number {
  const db = getDb();
  const r = db.execute(
    'SELECT COUNT(*) as cnt FROM punch_events WHERE synced = 0 AND sync_attempts < ?',
    [MAX_SYNC_ATTEMPTS],
  );
  return r.rows?.item(0)?.cnt ?? 0;
}

/**
 * Count of events that have exhausted their auto-retry budget. Admin/dev tools
 * can surface this so a human can decide what to do.
 */
export function getStuckCount(): number {
  const db = getDb();
  const r = db.execute(
    'SELECT COUNT(*) as cnt FROM punch_events WHERE synced = 0 AND sync_attempts >= ?',
    [MAX_SYNC_ATTEMPTS],
  );
  return r.rows?.item(0)?.cnt ?? 0;
}

export function markSynced(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.execute(
    `UPDATE punch_events SET synced = 1, last_sync_error = NULL WHERE id IN (${placeholders})`,
    ids,
  );
}

export function markSyncFailed(
  ids: string[],
  error: string,
  incrementAttempts = true,
): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  // Only consume the lifetime retry budget for SERVER-side rejections. A
  // transient network/timeout failure must NOT count toward MAX_SYNC_ATTEMPTS,
  // otherwise repeated manual Sync taps while offline/flaky-tunnel would
  // silently strand genuine, never-uploaded events past the budget forever.
  const setAttempts = incrementAttempts ? 'sync_attempts = sync_attempts + 1, ' : '';
  db.execute(
    `UPDATE punch_events SET ${setAttempts}last_sync_error = ? WHERE id IN (${placeholders})`,
    [error, ...ids],
  );
}
