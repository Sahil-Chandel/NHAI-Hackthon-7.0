/**
 * Face signature from ML Kit landmarks, using anthropometric biometric ratios.
 *
 * Computes ~30 person-specific ratios (eye spacing, mouth proportions, nose
 * position, facial symmetry) that vary between individuals while staying
 * stable for the same person across angles. Padded + L2-normalized to 512-d
 * for compatibility with the existing match pipeline.
 */

export type SignatureResult = {
  embedding: number[];
  magnitude: number;
  latencyMs: number;
  source?: 'edgeface' | 'mlkit_fallback';
};

function dist(a: {x: number; y: number}, b: {x: number; y: number}): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function extractMLKitSignature(
  face: any,
  frameWidth: number,
  frameHeight: number,
): SignatureResult | null {
  'worklet';

  const start = performance.now();
  const sig = new Array(512);
  for (let i = 0; i < 512; i++) sig[i] = 0;

  const b = face.bounds ?? {};
  const bw = b.width ?? 0;
  const bh = b.height ?? 0;
  if (bw < 10 || bh < 10) return null;

  const lms = face.landmarks ?? {};
  const get = (key: string): {x: number; y: number} | null => {
    const lm = lms[key];
    if (lm && lm.position && typeof lm.position.x === 'number') {
      return {x: lm.position.x, y: lm.position.y};
    }
    return null;
  };

  // Synthesize landmarks from bounds when ML Kit doesn't return them
  // (fast mode may omit some). Use canonical face proportions as fallback.
  const cxBase = (b.x ?? 0) + bw / 2;
  const cyBase = (b.y ?? 0) + bh / 2;
  const leftEye =
    get('LEFT_EYE') ?? {x: cxBase - bw * 0.18, y: cyBase - bh * 0.12};
  const rightEye =
    get('RIGHT_EYE') ?? {x: cxBase + bw * 0.18, y: cyBase - bh * 0.12};
  const noseBase =
    get('NOSE_BASE') ?? {x: cxBase, y: cyBase + bh * 0.05};
  const leftMouth = get('LEFT_MOUTH');
  const rightMouth = get('RIGHT_MOUTH');
  const bottomMouth = get('BOTTOM_MOUTH');
  const leftCheek = get('LEFT_CHEEK');
  const rightCheek = get('RIGHT_CHEEK');
  const leftEar = get('LEFT_EAR');
  const rightEar = get('RIGHT_EAR');

  const faceDiag = Math.sqrt(bw * bw + bh * bh);
  // Normalize distances by face diagonal (scale-invariant)
  const nd = (a: {x: number; y: number}, c: {x: number; y: number}) =>
    dist(a, c) / faceDiag;

  let idx = 0;

  // ===== Anthropometric ratios (person-specific) =====
  const eyeDist = nd(leftEye, rightEye);
  sig[idx++] = eyeDist;
  sig[idx++] = nd(leftEye, noseBase);
  sig[idx++] = nd(rightEye, noseBase);
  // Inter-ocular symmetry — ratio left:right nose distance
  sig[idx++] = nd(leftEye, noseBase) / Math.max(nd(rightEye, noseBase), 1e-6);

  if (leftMouth && rightMouth) {
    const mouthWidth = nd(leftMouth, rightMouth);
    sig[idx++] = mouthWidth;
    sig[idx++] = mouthWidth / Math.max(eyeDist, 1e-6); // mouth-to-eye ratio
    sig[idx++] = nd(leftMouth, leftEye);
    sig[idx++] = nd(rightMouth, rightEye);
    sig[idx++] = nd(leftMouth, noseBase);
    sig[idx++] = nd(rightMouth, noseBase);
  } else {
    idx += 6;
  }

  if (bottomMouth) {
    sig[idx++] = nd(bottomMouth, noseBase); // nose-to-chin proxy
    sig[idx++] = nd(bottomMouth, leftEye);
    sig[idx++] = nd(bottomMouth, rightEye);
  } else {
    idx += 3;
  }

  if (leftCheek && rightCheek) {
    sig[idx++] = nd(leftCheek, rightCheek); // cheek-to-cheek (face width proxy)
    sig[idx++] = nd(leftCheek, leftEye);
    sig[idx++] = nd(rightCheek, rightEye);
    sig[idx++] = nd(leftCheek, noseBase);
    sig[idx++] = nd(rightCheek, noseBase);
  } else {
    idx += 5;
  }

  if (leftEar && rightEar) {
    sig[idx++] = nd(leftEar, rightEar); // total face width
    sig[idx++] = nd(leftEar, leftEye);
    sig[idx++] = nd(rightEar, rightEye);
  } else {
    idx += 3;
  }

  // ===== Face shape =====
  sig[idx++] = bw / bh; // aspect ratio
  sig[idx++] = bw / (frameWidth || 1);

  // ===== Eye/mouth offsets relative to face center =====
  const cx = (b.x ?? 0) + bw / 2;
  const cy = (b.y ?? 0) + bh / 2;
  sig[idx++] = (leftEye.x - cx) / bw;
  sig[idx++] = (leftEye.y - cy) / bh;
  sig[idx++] = (rightEye.x - cx) / bw;
  sig[idx++] = (rightEye.y - cy) / bh;
  sig[idx++] = (noseBase.x - cx) / bw;
  sig[idx++] = (noseBase.y - cy) / bh;

  // L2-normalize populated portion
  let sumSq = 0;
  for (let i = 0; i < idx; i++) sumSq += sig[i] * sig[i];
  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 1e-8) {
    for (let i = 0; i < idx; i++) sig[i] = sig[i] / magnitude;
  }

  return {
    embedding: sig,
    magnitude: magnitude * 30, // scale to MagFace-like range
    latencyMs: performance.now() - start,
    source: 'mlkit_fallback',
  };
}
