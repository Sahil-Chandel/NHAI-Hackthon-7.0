import {THRESHOLDS} from '../thresholds';

export type HeadTurnDirection = 'left' | 'right';

export type HeadTurnState =
  | 'waiting_turn'
  | 'waiting_return'
  | 'passed'
  | 'failed';

export function initHeadTurnState(): HeadTurnState {
  return 'waiting_turn';
}

export function updateHeadTurnState(
  state: HeadTurnState,
  direction: HeadTurnDirection,
  yawAngle: number,
  elapsedMs: number,
): HeadTurnState {
  if (state === 'passed' || state === 'failed') return state;
  if (elapsedMs > THRESHOLDS.CHALLENGE_STEP_TIMEOUT_MS) return 'failed';

  const isTurned =
    direction === 'left'
      ? yawAngle < -THRESHOLDS.YAW_TURN_DEG
      : yawAngle > THRESHOLDS.YAW_TURN_DEG;
  const isCenter = Math.abs(yawAngle) < THRESHOLDS.YAW_CENTER_DEG;

  switch (state) {
    case 'waiting_turn':
      return isTurned ? 'waiting_return' : 'waiting_turn';
    case 'waiting_return':
      return isCenter ? 'passed' : 'waiting_return';
    default:
      return state;
  }
}
