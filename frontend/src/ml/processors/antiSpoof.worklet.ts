import type {TensorflowModel} from 'react-native-fast-tflite';
import {THRESHOLDS} from '../thresholds';

export type AntiSpoofResult = {
  realScore: number;
  isReal: boolean;
  latencyMs: number;
};

function softmax3(logits: Float32Array): [number, number, number] {
  'worklet';
  const max = Math.max(logits[0], logits[1], logits[2]);
  const e0 = Math.exp(logits[0] - max);
  const e1 = Math.exp(logits[1] - max);
  const e2 = Math.exp(logits[2] - max);
  const sum = e0 + e1 + e2;
  return [e0 / sum, e1 / sum, e2 / sum];
}

export function runAntiSpoof(
  modelV2: TensorflowModel,
  modelV1SE: TensorflowModel,
  frame: any,
): AntiSpoofResult | null {
  'worklet';

  const start = performance.now();

  try {
    const outV2 = modelV2.runSync([frame]);
    const outV1SE = modelV1SE.runSync([frame]);

    if (!outV2 || !outV1SE || outV2.length === 0 || outV1SE.length === 0) {
      return null;
    }

    const rawV2 = new Float32Array(outV2[0] as unknown as ArrayBuffer);
    const rawV1SE = new Float32Array(outV1SE[0] as unknown as ArrayBuffer);

    if (rawV2.length < 3 || rawV1SE.length < 3) return null;

    const probsV2 = softmax3(rawV2);
    const probsV1SE = softmax3(rawV1SE);

    const realScore = (probsV2[1] + probsV1SE[1]) / 2;

    return {
      realScore,
      isReal: realScore > THRESHOLDS.PAD_LIVENESS,
      latencyMs: performance.now() - start,
    };
  } catch {
    return null;
  }
}
