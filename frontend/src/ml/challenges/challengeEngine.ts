import {THRESHOLDS} from '../thresholds';
import {initBlinkState, updateBlinkState, type BlinkState} from './blink';
import {
  initHeadTurnState,
  updateHeadTurnState,
  type HeadTurnState,
  type HeadTurnDirection,
} from './headTurn';
import {initSmileState, updateSmileState, type SmileState} from './smile';

export type ChallengeType = 'blink' | 'head_left' | 'head_right' | 'smile';

export type SequenceStatus = 'idle' | 'active' | 'passed' | 'failed';

export interface FaceData {
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
  smilingProbability: number;
  yawAngle: number;
}

export interface ChallengeState {
  sequence: ChallengeType[];
  currentIndex: number;
  status: SequenceStatus;
  challengeStartMs: number;
  smileSustainedMs: number;
  blinkState: BlinkState;
  headTurnState: HeadTurnState;
  smileState: SmileState;
  retried: boolean;
}

export function generateSequence(): ChallengeType[] {
  const all: ChallengeType[] = ['blink', 'head_left', 'head_right', 'smile'];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, 3);
}

export function initChallengeState(): ChallengeState {
  const sequence = generateSequence();
  return {
    sequence,
    currentIndex: 0,
    status: 'active',
    challengeStartMs: Date.now(),
    smileSustainedMs: 0,
    blinkState: initBlinkState(),
    headTurnState: initHeadTurnState(),
    smileState: initSmileState(),
    retried: false,
  };
}

function resetChallengeForStep(state: ChallengeState): ChallengeState {
  return {
    ...state,
    challengeStartMs: Date.now(),
    smileSustainedMs: 0,
    blinkState: initBlinkState(),
    headTurnState: initHeadTurnState(),
    smileState: initSmileState(),
  };
}

export function currentChallenge(state: ChallengeState): ChallengeType | null {
  if (state.status !== 'active') return null;
  return state.sequence[state.currentIndex] ?? null;
}

export function updateChallenge(
  state: ChallengeState,
  face: FaceData,
  deltaMs: number,
): ChallengeState {
  if (state.status !== 'active') return state;

  const challenge = state.sequence[state.currentIndex];
  if (!challenge) return {...state, status: 'passed'};

  const elapsed = Date.now() - state.challengeStartMs;
  let challengePassed = false;
  let challengeFailed = false;
  let next = {...state};

  switch (challenge) {
    case 'blink': {
      const bs = updateBlinkState(
        state.blinkState,
        face.leftEyeOpenProbability,
        face.rightEyeOpenProbability,
        elapsed,
      );
      next.blinkState = bs;
      challengePassed = bs === 'passed';
      challengeFailed = bs === 'failed';
      break;
    }
    case 'head_left':
    case 'head_right': {
      const dir: HeadTurnDirection =
        challenge === 'head_left' ? 'left' : 'right';
      const hs = updateHeadTurnState(
        state.headTurnState,
        dir,
        face.yawAngle,
        elapsed,
      );
      next.headTurnState = hs;
      challengePassed = hs === 'passed';
      challengeFailed = hs === 'failed';
      break;
    }
    case 'smile': {
      const sustained =
        face.smilingProbability > THRESHOLDS.SMILE_THRESHOLD
          ? state.smileSustainedMs + deltaMs
          : 0;
      next.smileSustainedMs = sustained;
      const ss = updateSmileState(
        state.smileState,
        face.smilingProbability,
        elapsed,
        sustained,
      );
      next.smileState = ss;
      challengePassed = ss === 'passed';
      challengeFailed = ss === 'failed';
      break;
    }
  }

  if (challengePassed) {
    const nextIdx = state.currentIndex + 1;
    if (nextIdx >= state.sequence.length) {
      return {...next, currentIndex: nextIdx, status: 'passed'};
    }
    return resetChallengeForStep({
      ...next,
      currentIndex: nextIdx,
      retried: false,
    });
  }

  if (challengeFailed) {
    if (!state.retried) {
      return resetChallengeForStep({...next, retried: true});
    }
    return {...next, status: 'failed'};
  }

  return next;
}
