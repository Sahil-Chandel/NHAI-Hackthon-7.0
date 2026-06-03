import {THRESHOLDS} from './thresholds';
import {checkQuality} from './processors/qualityGate';
import {findBestMatch, setTemplates, getTemplateCount} from '../storage/vectorMatch';
import type {MatchResult, Template} from '../storage/vectorMatch';
import {getAllTemplates, getBioHashData} from '../storage/db/templates.repo';
import {insertTemplate} from '../storage/db/templates.repo';
import {bioHash, bioHashMatch, generateSalt} from '../storage/crypto/bioHash';
import {getThresholdSync} from './processors/adaptiveThreshold';

export type PipelineResult = {
  stage: 'no_face' | 'low_quality' | 'no_templates' | 'matched' | 'no_match' | 'enrolled';
  match?: MatchResult;
  quality?: {magnitude: number; passed: boolean; reason?: string};
  embeddingLatencyMs?: number;
  bioHashVerified?: boolean;
  bioHashDistance?: number;
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
): PipelineResult {
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

  const match = findBestMatch(embedding, THRESHOLDS.MATCH_COSINE, getThresholdSync);
  if (match) {
    // Dual verification — also confirm via BioHash (ISO/IEC 24745)
    // Cosine identifies; BioHash provides cancellable cryptographic confirmation.
    const bh = getBioHashData(match.id);
    let bioHashVerified = false;
    let bioHashDistance: number | undefined;
    if (bh) {
      const result = bioHashMatch(
        embedding,
        bh.bioHash,
        bh.salt,
        THRESHOLDS.BIOHASH_HAMMING_MAX,
      );
      bioHashVerified = result.match;
      bioHashDistance = result.normalizedDistance;
    } else {
      // Legacy template without BioHash data — accept cosine-only match
      bioHashVerified = true;
    }

    return {
      stage: bioHashVerified ? 'matched' : 'no_match',
      match: bioHashVerified ? match : undefined,
      quality,
      embeddingLatencyMs: latencyMs,
      bioHashVerified,
      bioHashDistance,
    };
  }

  return {
    stage: 'no_match',
    quality,
    embeddingLatencyMs: latencyMs,
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

  const id = insertTemplate(userId, name, embedding, hash, salt);
  reloadTemplates();

  return {id, bioHashStored: true};
}
