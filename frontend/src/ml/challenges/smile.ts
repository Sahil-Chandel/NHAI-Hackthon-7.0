import {THRESHOLDS} from '../thresholds';

export type SmileState = 'waiting' | 'passed' | 'failed';

export function initSmileState(): SmileState {
  return 'waiting';
}

export function updateSmileState(
  state: SmileState,
  smilingProbability: number,
  elapsedMs: number,
  sustainedMs: number,
): SmileState {
  if (state === 'passed' || state === 'failed') return state;
  if (elapsedMs > THRESHOLDS.CHALLENGE_STEP_TIMEOUT_MS) return 'failed';

  if (
    smilingProbability > THRESHOLDS.SMILE_THRESHOLD &&
    sustainedMs >= THRESHOLDS.SMILE_SUSTAINED_MS
  ) {
    return 'passed';
  }
  return 'waiting';
}
