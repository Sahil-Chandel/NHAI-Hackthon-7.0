/**
 * BioHashing — ISO/IEC 24745 compliant cancellable biometric template.
 *
 * Generates a pseudo-random orthonormal projection matrix M seeded by a
 * per-user salt. Projects the 512-d embedding, then sign-quantizes to
 * produce a 512-bit binary hash. Only the hash + salt are stored;
 * the original embedding is irrecoverable.
 *
 * On verify: regenerate M from salt, hash the live embedding,
 * compare via Hamming distance.
 */

const DIM = 512;

function seededRng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }

  return () => {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    return ((h >>> 0) / 4294967296);
  };
}

// Projection matrices are deterministic per salt; cache last few to avoid
// recomputing the 512x512 Gram-Schmidt on every verification frame.
const MATRIX_CACHE_SIZE = 8;
const matrixCache = new Map<string, number[][]>();

function generateProjectionMatrix(salt: string): number[][] {
  const cached = matrixCache.get(salt);
  if (cached) return cached;

  const rng = seededRng(salt);
  const matrix: number[][] = [];

  for (let i = 0; i < DIM; i++) {
    const row = new Array(DIM);
    for (let j = 0; j < DIM; j++) {
      // Box-Muller for Gaussian random
      const u1 = rng() || 1e-10;
      const u2 = rng();
      row[j] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // Gram-Schmidt orthogonalization against previous rows
    for (let k = 0; k < i; k++) {
      let dot = 0;
      for (let j = 0; j < DIM; j++) {
        dot += row[j] * matrix[k][j];
      }
      for (let j = 0; j < DIM; j++) {
        row[j] -= dot * matrix[k][j];
      }
    }

    // Normalize
    let norm = 0;
    for (let j = 0; j < DIM; j++) {
      norm += row[j] * row[j];
    }
    norm = Math.sqrt(norm);
    if (norm > 1e-10) {
      for (let j = 0; j < DIM; j++) {
        row[j] /= norm;
      }
    }

    matrix.push(row);
  }

  // Evict oldest entry if cache full (Map iterates in insertion order)
  if (matrixCache.size >= MATRIX_CACHE_SIZE) {
    const oldest = matrixCache.keys().next().value;
    if (oldest !== undefined) matrixCache.delete(oldest);
  }
  matrixCache.set(salt, matrix);

  return matrix;
}

export function generateSalt(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len = 32;
  // The salt seeds the cancellable-biometric projection — it must be drawn from
  // a CSPRNG, not Math.random (predictable, weakens the cancellability). Mirror
  // dbKey.ts: prefer libsodium, then Web Crypto, with a loud Math.random
  // fallback so enrollment never hard-fails if the native module isn't linked.
  const bytes = new Uint8Array(len);
  let filled = false;
  try {
    const libsodium = require('react-native-libsodium');
    bytes.set(libsodium.randombytes_buf(len) as Uint8Array);
    filled = true;
  } catch {}
  if (!filled && typeof (globalThis as any).crypto?.getRandomValues === 'function') {
    (globalThis as any).crypto.getRandomValues(bytes);
    filled = true;
  }
  if (!filled) {
    console.warn('[bioHash] CSPRNG unavailable — falling back to Math.random for salt');
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let salt = '';
  for (let i = 0; i < len; i++) salt += chars[bytes[i] % chars.length];
  return salt;
}

export function bioHash(embedding: number[], salt: string): string {
  const M = generateProjectionMatrix(salt);
  const bits: string[] = [];

  for (let i = 0; i < DIM; i++) {
    let projected = 0;
    for (let j = 0; j < DIM; j++) {
      projected += M[i][j] * embedding[j];
    }
    bits.push(projected > 0 ? '1' : '0');
  }

  return bits.join('');
}

export function hammingDistance(hash1: string, hash2: string): number {
  let dist = 0;
  const len = Math.min(hash1.length, hash2.length);
  for (let i = 0; i < len; i++) {
    if (hash1[i] !== hash2[i]) dist++;
  }
  return dist;
}

export function bioHashMatch(
  liveEmbedding: number[],
  storedHash: string,
  salt: string,
  threshold: number = 0.35,
): {match: boolean; normalizedDistance: number} {
  const liveHash = bioHash(liveEmbedding, salt);
  const dist = hammingDistance(liveHash, storedHash);
  const normalizedDistance = dist / DIM;

  return {
    match: normalizedDistance < threshold,
    normalizedDistance,
  };
}
