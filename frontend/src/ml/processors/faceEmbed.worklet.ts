import type {TensorflowModel} from 'react-native-fast-tflite';

// `source` tells the pipeline which engine produced the vector. Identity
// verification is only trustworthy on a real 'edgeface' embedding; the
// 'mlkit_fallback' landmark signature is non-discriminative (scores ~0.99
// between different people) and must be refused for verification, not matched.
export type EmbeddingSource = 'edgeface' | 'mlkit_fallback';

export type EmbeddingResult = {
  embedding: number[];
  magnitude: number;
  latencyMs: number;
  source?: EmbeddingSource;
};

export function extractEmbedding(
  model: TensorflowModel,
  frame: any,
): EmbeddingResult | null {
  'worklet';

  const start = performance.now();

  try {
    const outputs = model.runSync([frame]);

    if (!outputs || outputs.length === 0) return null;

    const raw = outputs[0] as any;
    if (!raw) return null;

    // Accept any output length >= 128 (typical embedding sizes vary by model)
    const len = raw.length ?? 0;
    if (len < 128) return null;

    const effectiveLen = Math.min(len, 512);

    // MagFace quality: L2 norm before normalization correlates with quality
    let sumSq = 0;
    for (let i = 0; i < effectiveLen; i++) {
      sumSq += raw[i] * raw[i];
    }
    const magnitude = Math.sqrt(sumSq);

    // L2-normalize for cosine similarity; pad/truncate to 512-d
    const embedding: number[] = new Array(512);
    if (magnitude > 1e-8) {
      for (let i = 0; i < 512; i++) {
        embedding[i] = i < effectiveLen ? raw[i] / magnitude : 0;
      }
    } else {
      for (let i = 0; i < 512; i++) {
        embedding[i] = 0;
      }
    }

    return {
      embedding,
      magnitude,
      latencyMs: performance.now() - start,
    };
  } catch {
    return null;
  }
}
