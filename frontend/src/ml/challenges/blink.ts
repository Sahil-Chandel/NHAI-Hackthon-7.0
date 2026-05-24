import {THRESHOLDS} from '../thresholds';

export type BlinkState =
  | 'waiting_close'
  | 'waiting_open'
  | 'passed'
  | 'failed';

export function initBlinkState(): BlinkState {
  return 'waiting_close';
}

export function updateBlinkState(
  state: BlinkState,
  leftEyeOpen: number,
  rightEyeOpen: number,
  elapsedMs: number,
): BlinkState {
  if (state === 'passed' || state === 'failed') return state;
  if (elapsedMs > THRESHOLDS.CHALLENGE_STEP_TIMEOUT_MS) return 'failed';

  const bothClosed =
    leftEyeOpen < THRESHOLDS.EYE_CLOSED_THRESHOLD &&
    rightEyeOpen < THRESHOLDS.EYE_CLOSED_THRESHOLD;
  const bothOpen =
    leftEyeOpen > THRESHOLDS.EYE_OPEN_THRESHOLD &&
    rightEyeOpen > THRESHOLDS.EYE_OPEN_THRESHOLD;

  switch (state) {
    case 'waiting_close':
      return bothClosed ? 'waiting_open' : 'waiting_close';
    case 'waiting_open':
      return bothOpen ? 'passed' : 'waiting_open';
    default:
      return state;
  }
}
