export const THRESHOLDS = {
  // Face detection (YuNet)
  DETECTION_CONFIDENCE: 0.4,
  DETECTION_IOU_NMS: 0.3,

  // Face recognition (EdgeFace / ML Kit signature) — tuned in Phase 8.
  // Raised 0.5→0.6 so punch-in/punch-out reject a non-matching face more
  // reliably (same-person self-match vs the 3-angle averaged template usually
  // scores ~0.7-0.9, so the real worker still passes comfortably). Lower back
  // toward 0.55 if a legitimate worker ever gets falsely rejected.
  MATCH_COSINE: 0.6,
  MATCH_REJECT: 0.3,

  // BioHash (ISO/IEC 24745) — Hamming distance threshold (normalized 0-1).
  // Tightened 0.35→0.30 alongside MATCH_COSINE for a stricter combined gate.
  BIOHASH_HAMMING_MAX: 0.3,

  // Anti-spoof (MiniFASNet) — start conservative, tune up in Phase 8
  PAD_LIVENESS: 0.5,

  // MagFace quality gate
  QUALITY_MAGNITUDE: 18.0,

  // Liveness challenges
  FACE_LOST_TIMEOUT_MS: 2000,
  EYE_CLOSED_THRESHOLD: 0.3,
  EYE_OPEN_THRESHOLD: 0.7,
  YAW_TURN_DEG: 15,
  YAW_CENTER_DEG: 10,
  SMILE_THRESHOLD: 0.7,
  SMILE_SUSTAINED_MS: 300,
  CHALLENGE_STEP_TIMEOUT_MS: 6000,

  // Adaptive threshold (Phase 7)
  ADAPTIVE_MIN_SAMPLES: 20,
  ADAPTIVE_SIGMA_FACTOR: 2.0,
  ADAPTIVE_COLD_START: 0.6,
} as const;
