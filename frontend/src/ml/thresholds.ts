export const THRESHOLDS = {
  // Face detection (YuNet)
  DETECTION_CONFIDENCE: 0.4,
  DETECTION_IOU_NMS: 0.3,

  // Face recognition — now using the REAL EdgeFace 512-d embedding (not the
  // landmark signature). For EdgeFace, genuine same-person cosine is typically
  // ~0.5-0.85 and a different person is <0.4, so 0.5 separates well: accepts
  // the real worker, rejects an impostor. (Tune on-device: raise toward 0.55
  // if any impostor slips through, lower toward 0.45 if the genuine worker is
  // rejected.)
  // Raised 0.5 → 0.78 from ON-DEVICE measurement: genuine worker self-match
  // ~0.85, a different (similar-looking) person peaked at ~0.72 with EdgeFace-XS.
  // 0.78 sits in that gap — rejects the impostor, accepts the genuine worker.
  // (EdgeFace-XS is a tiny model with weak separation between similar faces, so
  // this gap is narrow; re-measure if a genuine worker gets falsely rejected.)
  MATCH_COSINE: 0.78,
  MATCH_REJECT: 0.3,

  // BioHash (ISO/IEC 24745) — Hamming distance threshold (normalized 0-1).
  // TELEMETRY / tamper + cancellability only, NOT an anti-impostor gate: BioHash
  // is a SimHash of the SAME embedding, so its Hamming distance just mirrors the
  // cosine decision and gives no independent discrimination. processEmbedding
  // records `bioHashVerified`/`bioHashDistance` but never lets them downgrade a
  // cosine match. Impostor rejection = EdgeFace cosine + consecutive-frame gate.
  BIOHASH_HAMMING_MAX: 0.4,

  // Anti-spoof (MiniFASNet) — start conservative, tune up in Phase 8
  PAD_LIVENESS: 0.5,

  // MagFace quality gate. Disabled (0) now that we feed real EdgeFace
  // embeddings — their raw L2 norm range differs from the old landmark
  // signature's faked magnitude, and face presence is already gated by the
  // ML-Kit detector. (Re-enable with a measured value once tuned on-device.)
  QUALITY_MAGNITUDE: 0.0,

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
  // Cold start MUST equal MATCH_COSINE — the live punch path reads the adaptive
  // threshold via getThresholdSync (cold cache → this value), NOT MATCH_COSINE
  // directly, so this is the number that actually gates a punch. Keep in sync.
  ADAPTIVE_COLD_START: 0.78,
} as const;
