import {THRESHOLDS} from './thresholds';
import {checkQuality} from './processors/qualityGate';
import {findBestMatch, bestMatch, setTemplates, getTemplateCount} from '../storage/vectorMatch';
import type {MatchResult, Template} from '../storage/vectorMatch';
import {getAllTemplates, getBioHashData} from '../storage/db/templates.repo';
import {insertTemplate, deleteTemplatesForUser} from '../storage/db/templates.repo';
import {bioHash, bioHashMatch, generateSalt} from '../storage/crypto/bioHash';
import {getThresholdSync} from './processors/adaptiveThreshold';

export type PipelineResult = {
  stage: 'no_face' | 'low_quality' | 'no_templates' | 'matched' | 'no_match' | 'enrolled';
  match?: MatchResult;
  quality?: {magnitude: number; passed: boolean; reason?: string};
  embeddingLatencyMs?: number;
  bioHashVerified?: boolean;
  bioHashDistance?: number;
  // Diagnostics: best template cosine + name REGARDLESS of the accept gate, so
  // the punch screen can show live genuine-vs-impostor separation.
  bestScore?: number;
  bestName?: string;
};

let initialized = false;

export function initPipeline(): void {
  if (initialized) return;
  const templates = getAllTemplates();
  setTemplates(templates);
  initialized = true;
}

export function reloadTemplates(): number {
  const templates = getAllTemplates();
  setTemplates(templates);
  return templates.length;
}

export function processEmbedding(
  embedding: number[],
  magnitude: number,
  latencyMs: number,
  source: 'edgeface' | 'mlkit_fallback' = 'edgeface',
): PipelineResult {
  // FAIL CLOSED: identity is only trustworthy on a REAL EdgeFace embedding.
  // When the tflite model isn't loaded/usable, the camera screens fall back to
  // the ML-Kit landmark signature, which scores ~0.99 cosine between DIFFERENT
  // people — verifying on it would accept anyone (the reported punch-out bug).
  // Refuse to match instead, with a distinct reason so the worker is told the
  // engine isn't ready (not that their face mismatched).
  if (source !== 'edgeface') {
    return {
      stage: 'low_quality',
      quality: {magnitude, passed: false, reason: 'face_engine_unavailable'},
      embeddingLatencyMs: latencyMs,
    };
  }

  const quality = checkQuality(magnitude);
  if (!quality.passed) {
    return {
      stage: 'low_quality',
      quality,
      embeddingLatencyMs: latencyMs,
    };
  }

  if (getTemplateCount() === 0) {
    return {
      stage: 'no_templates',
      quality,
      embeddingLatencyMs: latencyMs,
    };
  }

  const top = bestMatch(embedding); // diagnostics: best score regardless of gate
  const match = findBestMatch(embedding, THRESHOLDS.MATCH_COSINE, getThresholdSync);
  if (match) {
    // BioHash (ISO/IEC 24745) is recorded for tamper / cancellability TELEMETRY
    // only — it is a SimHash of the SAME embedding, so its Hamming distance
    // mirrors the cosine decision and gives no independent impostor rejection.
    // It therefore must NOT downgrade a cosine match (that only risked falsely
    // rejecting a genuine borderline worker). Real impostor rejection comes
    // from the EdgeFace cosine gate + the consecutive-frame check in
    // PunchCaptureScreen.
    let bioHashVerified = true;
    let bioHashDistance: number | undefined;
    const bh = getBioHashData(match.id);
    if (bh) {
      const result = bioHashMatch(
        embedding,
        bh.bioHash,
        bh.salt,
        THRESHOLDS.BIOHASH_HAMMING_MAX,
      );
      bioHashVerified = result.match;
      bioHashDistance = result.normalizedDistance;
    }

    return {
      stage: 'matched',
      match,
      quality,
      embeddingLatencyMs: latencyMs,
      bioHashVerified,
      bioHashDistance,
      bestScore: top?.score,
      bestName: top?.name,
    };
  }

  return {
    stage: 'no_match',
    quality,
    embeddingLatencyMs: latencyMs,
    bestScore: top?.score,
    bestName: top?.name,
  };
}

/**
 * Derive a high-level role from our internal userId convention. We prefix
 * template userIds with `admin-` / `worker-` at the call sites that create
 * them (AdminSignupScreen, AddWorkerScreen). Anything else is "unknown" —
 * legacy enrollments from the original generic Enroll flow fall here.
 */
export type EnrolledRole = 'admin' | 'worker' | 'unknown';

export function roleFromUserId(uid: string): EnrolledRole {
  if (uid.startsWith('admin-')) return 'admin';
  if (uid.startsWith('worker-')) return 'worker';
  return 'unknown';
}

/**
 * Thrown by `enrollFace` when the captured face is already in the local
 * templates table under a different identity. Carries enough structured info
 * (role + name) so the originating screen can show a context-aware message
 * ("you are already registered as a worker" vs. "as an admin").
 */
export class DuplicateFaceError extends Error {
  readonly existingUserId: string;
  readonly existingName: string;
  readonly existingRole: EnrolledRole;
  constructor(existingUserId: string, existingName: string) {
    const role = roleFromUserId(existingUserId);
    super(
      `Face already enrolled as "${existingName}" (role: ${role}, id: ${existingUserId})`,
    );
    this.name = 'DuplicateFaceError';
    this.existingUserId = existingUserId;
    this.existingName = existingName;
    this.existingRole = role;
  }
}

export function enrollFace(
  userId: string,
  name: string,
  embedding: number[],
  skipDuplicateCheck = false,
): {id: string; bioHashStored: boolean} {
  // Duplicate face check — prevent enrolling the same face under a different
  // identity. Skipped for Datalake worker onboarding: identity is already
  // established by the 4-field registry match + JWT, and the weak ML-Kit
  // landmark signature can false-positive between similar (e.g. related) faces
  // on a shared device, which would otherwise permanently lock a legitimate
  // worker out of onboarding.
  if (!skipDuplicateCheck) {
    const existingMatch = findBestMatch(embedding, THRESHOLDS.MATCH_COSINE);
    if (existingMatch && existingMatch.userId !== userId) {
      throw new DuplicateFaceError(existingMatch.userId, existingMatch.name);
    }
  }

  const salt = generateSalt();
  const hash = bioHash(embedding, salt);

  // One current template per user_id: clear any prior rows so re-onboarding
  // (new device / retry) replaces rather than accumulates stale embeddings.
  deleteTemplatesForUser(userId);
  const id = insertTemplate(userId, name, embedding, hash, salt);
  reloadTemplates();

  return {id, bioHashStored: true};
}
