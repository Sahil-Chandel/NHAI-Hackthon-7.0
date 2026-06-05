import AsyncStorage from '@react-native-async-storage/async-storage';
import {THRESHOLDS} from '../thresholds';

const STORE_KEY = '@nhai_adaptive_scores';

const thresholdCache: Map<string, number> = new Map();

interface AdaptiveData {
  scores: number[];
  threshold: number;
}

async function loadData(userId: string): Promise<AdaptiveData> {
  const raw = await AsyncStorage.getItem(`${STORE_KEY}_${userId}`);
  if (!raw) return {scores: [], threshold: THRESHOLDS.ADAPTIVE_COLD_START};
  try {
    return JSON.parse(raw);
  } catch {
    return {scores: [], threshold: THRESHOLDS.ADAPTIVE_COLD_START};
  }
}

async function saveData(userId: string, data: AdaptiveData): Promise<void> {
  await AsyncStorage.setItem(`${STORE_KEY}_${userId}`, JSON.stringify(data));
}

export async function recordScore(userId: string, cosineScore: number): Promise<void> {
  const data = await loadData(userId);
  data.scores.push(cosineScore);

  if (data.scores.length > 200) {
    data.scores = data.scores.slice(-200);
  }

  if (data.scores.length >= THRESHOLDS.ADAPTIVE_MIN_SAMPLES) {
    const n = data.scores.length;
    const mean = data.scores.reduce((a, b) => a + b, 0) / n;
    const variance = data.scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    // Floor at the global accept threshold so a user's adaptive gate can only
    // TIGHTEN above MATCH_COSINE — never drift below it (which would loosen the
    // gate toward MATCH_REJECT and start admitting impostors).
    data.threshold = Math.max(
      THRESHOLDS.MATCH_COSINE,
      mean - THRESHOLDS.ADAPTIVE_SIGMA_FACTOR * std,
    );
  }

  thresholdCache.set(userId, data.threshold);
  await saveData(userId, data);
}

export function getThresholdSync(userId: string): number {
  return thresholdCache.get(userId) ?? THRESHOLDS.ADAPTIVE_COLD_START;
}

export async function preloadThreshold(userId: string): Promise<void> {
  const data = await loadData(userId);
  thresholdCache.set(userId, data.threshold);
}

export async function getAdaptiveThreshold(userId: string): Promise<number> {
  const data = await loadData(userId);
  thresholdCache.set(userId, data.threshold);
  return data.threshold;
}

export async function getAdaptiveStats(userId: string): Promise<{
  samples: number;
  mean: number;
  std: number;
  threshold: number;
}> {
  const data = await loadData(userId);
  const n = data.scores.length;
  if (n === 0) {
    return {samples: 0, mean: 0, std: 0, threshold: data.threshold};
  }
  const mean = data.scores.reduce((a, b) => a + b, 0) / n;
  const variance = data.scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {samples: n, mean, std: Math.sqrt(variance), threshold: data.threshold};
}
