import {
  getUnsyncedEvents,
  markSynced,
  markSyncFailed,
  getUnsyncedCount,
  type PunchEventRow,
} from '../storage/db/punchEvents.repo';
import {syncPunchEvents, type PunchEventDTO} from './punchApi';
import {withRetry} from './retryPolicy';
import {useSession} from '../app/auth/sessionStore';

let inFlight = false;

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

export function subscribeUnsyncedCount(fn: Listener): () => void {
  listeners.add(fn);
  try {
    fn(getUnsyncedCount());
  } catch {}
  return () => listeners.delete(fn);
}

function broadcast() {
  try {
    const cnt = getUnsyncedCount();
    listeners.forEach(l => l(cnt));
  } catch {}
}

function rowToDto(row: PunchEventRow): PunchEventDTO {
  return {
    id: row.id,
    type: row.type,
    timestamp: new Date(row.timestamp).toISOString(),
    gps_lat: row.gpsLat,
    gps_lon: row.gpsLon,
    gps_accuracy: row.gpsAccuracy,
    face_match_score: row.faceMatchScore,
    liveness_passed: row.livenessPassed,
    device_id: row.deviceId,
  };
}

export type PunchSyncResult = {
  attempted: number;
  synced: number;
  failed: number;
  authMissing?: boolean;
  networkError?: boolean;
  /** A sync was already in flight; this call did nothing (not a success). */
  skipped?: boolean;
};

/**
 * Drains the local punch_events table by uploading batches of up to 50 to backend.
 * Only runs if a worker JWT is present. Idempotent on event_id (backend handles dupes).
 */
export async function triggerPunchSync(maxBatches = 5): Promise<PunchSyncResult> {
  if (inFlight) return {attempted: 0, synced: 0, failed: 0, skipped: true};

  const role = useSession.getState().role;
  const token = useSession.getState().token;
  if (role !== 'worker' || !token) {
    return {attempted: 0, synced: 0, failed: 0, authMissing: true};
  }

  inFlight = true;
  let totalAttempted = 0;
  let totalSynced = 0;
  let totalFailed = 0;
  let networkError = false;

  try {
    for (let batch = 0; batch < maxBatches; batch++) {
      let rows: PunchEventRow[] = [];
      try {
        rows = getUnsyncedEvents(50);
      } catch {
        break;
      }
      if (rows.length === 0) break;

      const dtos = rows.map(rowToDto);
      totalAttempted += dtos.length;

      try {
        // 2 retries (so 1 initial + 1 retry) is enough — both NetInfo
        // reconnect and AppState foreground hooks will re-invoke us anyway,
        // and we cap each event's lifetime retry budget in the repo.
        const resp = await withRetry(() => syncPunchEvents(dtos), 2);
        // server "rejected" means it already existed → also safe to mark synced
        const handled = new Set([...resp.accepted, ...resp.rejected]);
        const ids = rows.filter(r => handled.has(r.id)).map(r => r.id);
        if (ids.length > 0) {
          markSynced(ids);
          broadcast(); // update the live unsynced count per batch (progress UI)
        }
        totalSynced += resp.accepted.length;
        const stillUnsynced = rows.filter(r => !handled.has(r.id));
        if (stillUnsynced.length > 0) {
          markSyncFailed(stillUnsynced.map(r => r.id), 'partial_ack');
          totalFailed += stillUnsynced.length;
          // No forward progress on these rows — stop so we don't re-fetch and
          // re-upload the same events (burning their retry budget) up to
          // maxBatches times within a single sync call.
          break;
        }
      } catch (e: any) {
        networkError = true;
        // Transient network/timeout failure → record the error but do NOT burn
        // the lifetime retry budget (incrementAttempts=false), so these events
        // stay retryable on the next manual Sync instead of being stranded.
        markSyncFailed(rows.map(r => r.id), e?.message || 'network', false);
        totalFailed += rows.length;
        break; // stop further batches on hard failure
      }
    }
  } finally {
    inFlight = false;
    broadcast();
  }

  return {
    attempted: totalAttempted,
    synced: totalSynced,
    failed: totalFailed,
    networkError,
  };
}

export function getCurrentUnsyncedCount(): number {
  try {
    return getUnsyncedCount();
  } catch {
    return 0;
  }
}
