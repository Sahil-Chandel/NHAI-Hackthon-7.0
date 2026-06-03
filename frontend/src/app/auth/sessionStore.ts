/**
 * Session store with hardened token storage.
 *
 * Architecture: zustand persist keeps the non-sensitive profile fields
 * (role, expiry, admin/worker metadata) in AsyncStorage so the app can
 * hydrate the UI without unlocking the keychain. The JWT itself lives in
 * the OS keychain (via `secureStore`) and is loaded asynchronously on
 * boot. Logout wipes BOTH stores plus the legacy `@nhai_jwt` axios cache.
 *
 * Why split: the profile fields render the Welcome/Dashboard headers
 * synchronously from the persist-rehydrated JSON. Putting the JWT in the
 * keychain means a rooted `adb pull` reveals "you have a session" but
 * cannot replay the token against the backend.
 */
import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {secureSet, secureGet, secureDelete} from '../../storage/secure/secureStore';

export type Role = 'worker' | 'admin' | null;

export type AdminProfile = {
  id: string;
  name: string;
  mobile: string;
  aadhar_masked: string;
};

export type WorkerProfile = {
  id: string;
  name: string;
  aadhar_masked: string;
  admin_id: string;
};

type SessionState = {
  role: Role;
  /** Cached in memory only — sourced from the keychain on `hydrateToken`. */
  token: string | null;
  tokenExpiresAt: number | null; // unix ms
  admin: AdminProfile | null;
  worker: WorkerProfile | null;
  hydrated: boolean;
  loginAsAdmin: (token: string, expiresInSec: number, admin: AdminProfile) => Promise<void>;
  loginAsWorker: (
    token: string,
    expiresInSec: number,
    worker: WorkerProfile,
  ) => Promise<void>;
  logout: () => Promise<void>;
  isExpired: () => boolean;
};

const TOKEN_KEYCHAIN_KEY = 'session_jwt';
// Legacy axios path used a separate AsyncStorage key — clear on logout so a
// stale device-token can't be revived.
const LEGACY_JWT_KEY = '@nhai_jwt';
const LEGACY_DEVICE_ID_KEY = '@device_id';

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      role: null,
      token: null,
      tokenExpiresAt: null,
      admin: null,
      worker: null,
      hydrated: false,
      loginAsAdmin: async (token, expiresInSec, admin) => {
        await secureSet(TOKEN_KEYCHAIN_KEY, token);
        set({
          role: 'admin',
          token,
          tokenExpiresAt: Date.now() + expiresInSec * 1000,
          admin,
          worker: null,
        });
      },
      loginAsWorker: async (token, expiresInSec, worker) => {
        await secureSet(TOKEN_KEYCHAIN_KEY, token);
        set({
          role: 'worker',
          token,
          tokenExpiresAt: Date.now() + expiresInSec * 1000,
          worker,
          admin: null,
        });
      },
      logout: async () => {
        // Belt-and-suspenders: clear the keychain copy, the in-memory copy,
        // AND any legacy axios-cached token / device-id from the old flow.
        try {
          await secureDelete(TOKEN_KEYCHAIN_KEY);
        } catch {}
        try {
          await Promise.all([
            AsyncStorage.removeItem(LEGACY_JWT_KEY),
            AsyncStorage.removeItem(LEGACY_DEVICE_ID_KEY),
          ]);
        } catch {}
        set({
          role: null,
          token: null,
          tokenExpiresAt: null,
          admin: null,
          worker: null,
        });
      },
      isExpired: () => {
        const exp = get().tokenExpiresAt;
        if (!exp) return true;
        return Date.now() > exp;
      },
    }),
    {
      name: '@nhai_session_v1',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => () => {
        // After zustand has put the persisted profile fields back in state,
        // pull the JWT from the keychain and merge it in. Then flip the
        // `hydrated` flag so UI guards (WelcomeScreen redirect, etc.) fire.
        (async () => {
          let t: string | null = null;
          try {
            t = await secureGet(TOKEN_KEYCHAIN_KEY);
          } catch {}
          if (t) {
            useSession.setState({token: t});
          } else if (useSession.getState().role !== null) {
            // Profile (role/expiry/worker) survived in AsyncStorage but the
            // keychain JWT is gone (reinstall / keychain wipe / read error). A
            // session without its token can't call the backend, so treat it as
            // logged-out rather than a valid session that redirects to Home.
            useSession.setState({
              role: null,
              token: null,
              tokenExpiresAt: null,
              admin: null,
              worker: null,
            });
          }
          useSession.setState({hydrated: true});
        })();
      },
      partialize: state => ({
        // Crucially: token is NOT in here. Profile is persisted; token comes
        // from the keychain on next launch.
        role: state.role,
        tokenExpiresAt: state.tokenExpiresAt,
        admin: state.admin,
        worker: state.worker,
      }),
    },
  ),
);

/**
 * Convenience selector: returns true once persisted session has been read from
 * AsyncStorage. Components that auto-redirect on session presence should wait
 * for this before deciding.
 */
export function useSessionHydrated(): boolean {
  return useSession(s => s.hydrated);
}

export function getAuthHeader(): Record<string, string> {
  const t = useSession.getState().token;
  return t ? {Authorization: `Bearer ${t}`} : {};
}
