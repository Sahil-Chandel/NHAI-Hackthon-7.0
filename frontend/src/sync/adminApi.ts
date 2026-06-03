import {apiFetch} from './httpClient';
import type {AdminProfile, WorkerProfile} from '../app/auth/sessionStore';

export type AdminTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  admin: AdminProfile;
};

export type WorkerTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  worker: WorkerProfile;
};

export type WorkerOut = {
  id: string;
  name: string;
  aadhar_masked: string;
  admin_id: string;
  active: boolean;
  created_at: string;
};

export async function adminSignup(payload: {
  name: string;
  mobile: string;
  aadhar: string;
  face_template_id?: string | null;
}): Promise<AdminTokenResponse> {
  return apiFetch('/api/v1/admin/signup', {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

export async function adminLogin(payload: {
  mobile: string;
  aadhar: string;
  face_template_id?: string | null;
}): Promise<AdminTokenResponse> {
  return apiFetch('/api/v1/admin/login', {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

export async function adminMe(): Promise<AdminProfile> {
  return apiFetch('/api/v1/admin/me');
}

export async function workerLogin(payload: {
  name: string;
  aadhar: string;
}): Promise<WorkerTokenResponse> {
  return apiFetch('/api/v1/worker/login', {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

// --- Datalake 3.0 self-onboarding ---

export type FaceRegisterResponse = {
  ok: boolean;
  worker_id: string;
  face_template_id: string;
  data_lake_updated: boolean;
};

/**
 * Step 1: match the worker's First/Last/mobile/email against the Datalake 3.0
 * registry. On success the backend returns a worker JWT + profile (its `id` is
 * the registry uuid). No prior token needed.
 */
export async function workerVerify(payload: {
  first_name: string;
  last_name: string;
  mobile: string;
  email: string;
}): Promise<WorkerTokenResponse> {
  return apiFetch('/api/v1/worker/verify', {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

/**
 * Step 2 (one-time): persist the enrolled face. The averaged embedding is
 * dual-written into the worker's registry row server-side. We pass the freshly
 * issued onboarding token explicitly because the session isn't committed until
 * face registration succeeds (so a half-onboarded worker can't reach Punch).
 */
export async function registerWorkerFace(
  payload: {face_template_id: string; embedding: number[]},
  token: string,
): Promise<FaceRegisterResponse> {
  return apiFetch('/api/v1/worker/register-face', {
    method: 'POST',
    body: payload,
    auth: false,
    headers: {Authorization: `Bearer ${token}`},
  });
}

export async function createWorker(payload: {
  name: string;
  aadhar: string;
  face_template_id?: string | null;
}): Promise<WorkerOut> {
  return apiFetch('/api/v1/workers', {
    method: 'POST',
    body: payload,
  });
}

export async function listWorkers(): Promise<WorkerOut[]> {
  return apiFetch('/api/v1/workers');
}

export async function deleteWorker(workerId: string): Promise<{ok: boolean}> {
  return apiFetch(`/api/v1/workers/${workerId}`, {method: 'DELETE'});
}
