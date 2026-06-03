import {Platform, PermissionsAndroid} from 'react-native';

export type LocationFix = {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
};

export type LocationResult =
  | {ok: true; fix: LocationFix}
  | {ok: false; reason: 'denied' | 'timeout' | 'unavailable' | 'error'; message: string};

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location for Attendance',
        message: 'Location is captured at punch-in/out to verify on-site attendance.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/**
 * Best-effort GPS fix with 10-second timeout. Never throws — always returns a result.
 */
export async function getCurrentLocation(
  timeoutMs = 10000,
): Promise<LocationResult> {
  const hasPerm = await ensurePermission();
  if (!hasPerm) {
    return {ok: false, reason: 'denied', message: 'Location permission denied'};
  }

  let Geo: any;
  try {
    Geo = require('@react-native-community/geolocation').default;
  } catch (e) {
    return {ok: false, reason: 'unavailable', message: 'Geolocation module missing'};
  }

  // Use the fused/auto provider (Play Services when available) and don't let the
  // module auto-prompt — we already requested the runtime permission above.
  try {
    Geo.setRNConfiguration?.({
      skipPermissionRequests: true,
      authorizationLevel: 'whenInUse',
      locationProvider: 'auto',
    });
  } catch {}

  // One getCurrentPosition attempt with a given accuracy mode.
  const attempt = (highAccuracy: boolean, ms: number): Promise<LocationResult> =>
    new Promise<LocationResult>(resolve => {
      let settled = false;
      const finish = (r: LocationResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const timer = setTimeout(
        () => finish({ok: false, reason: 'timeout', message: 'GPS fix not obtained in time'}),
        ms + 500,
      );
      try {
        Geo.getCurrentPosition(
          (pos: any) => {
            clearTimeout(timer);
            finish({
              ok: true,
              fix: {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? 0,
                timestamp: pos.timestamp ?? Date.now(),
              },
            });
          },
          (err: any) => {
            clearTimeout(timer);
            finish({ok: false, reason: 'error', message: err?.message || 'GPS error'});
          },
          {
            enableHighAccuracy: highAccuracy,
            timeout: ms,
            // High-accuracy: insist on a fresh GPS fix. Low-accuracy fallback:
            // accept a recent cached network fix so it resolves fast indoors.
            maximumAge: highAccuracy ? 10000 : 120000,
          },
        );
      } catch (e: any) {
        clearTimeout(timer);
        finish({ok: false, reason: 'error', message: e?.message || 'GPS init failed'});
      }
    });

  // Stage 1: high-accuracy GPS (best outdoors). Stage 2: low-accuracy network/
  // fused fallback — this is what makes it resolve indoors instead of always
  // showing "Location unavailable". Budget split ~60/40.
  const hiMs = Math.max(4000, Math.floor(timeoutMs * 0.6));
  const first = await attempt(true, hiMs);
  if (first.ok) return first;
  const loMs = Math.max(4000, timeoutMs - hiMs);
  const second = await attempt(false, loMs);
  return second.ok ? second : first;
}
