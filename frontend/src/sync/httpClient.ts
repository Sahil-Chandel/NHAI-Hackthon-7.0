// Lightweight fetch-based client for the new role-based auth endpoints
// (kept separate from the legacy axios-based apiClient.ts which uses device JWT)
import {useSession} from '../app/auth/sessionStore';
import {API_HOST} from './apiConfig';

const DEFAULT_BASE_URL = API_HOST; // resolved per-platform / LAN IP — see apiConfig.ts

let baseUrl = DEFAULT_BASE_URL;

export function setApiBaseUrl(url: string) {
  baseUrl = url.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public body?: any,
  ) {
    super(detail || `HTTP ${status}`);
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  auth?: boolean;
};

export async function apiFetch<T = any>(
  path: string,
  opts: Options = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = 15000,
    auth = true,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (auth) {
    const token = useSession.getState().token;
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  try {
    const url = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const resp = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    let payload: any = null;
    const text = await resp.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      if (payload) {
        const raw = payload.detail || payload.message;
        if (typeof raw === 'string') {
          detail = raw;
        } else if (Array.isArray(raw)) {
          detail = raw.map((e: any) => e?.msg || JSON.stringify(e)).join('; ');
        } else if (raw) {
          detail = JSON.stringify(raw);
        }
      }
      throw new ApiError(resp.status, detail, payload);
    }
    return payload as T;
  } catch (e: any) {
    clearTimeout(timer);
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out');
    }
    throw new ApiError(0, e?.message || 'Network error');
  }
}
