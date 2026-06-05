export type MatchResult = {
  id: string;
  userId: string;
  name: string;
  score: number;
};

export type Template = {
  id: string;
  userId: string;
  name: string;
  embedding: number[];
};

let templateCache: Template[] = [];

export function setTemplates(templates: Template[]): void {
  templateCache = templates;
}

export function getTemplateCount(): number {
  return templateCache.length;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export function findBestMatch(
  embedding: number[],
  globalThreshold: number,
  getUserThreshold?: (userId: string) => number,
): MatchResult | null {
  let bestScore = -1;
  let bestTemplate: Template | null = null;

  for (const tmpl of templateCache) {
    const score = cosineSimilarity(embedding, tmpl.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = tmpl;
    }
  }

  if (bestTemplate) {
    const threshold = getUserThreshold
      ? getUserThreshold(bestTemplate.userId)
      : globalThreshold;
    if (bestScore >= threshold) {
      return {
        id: bestTemplate.id,
        userId: bestTemplate.userId,
        name: bestTemplate.name,
        score: bestScore,
      };
    }
  }

  return null;
}

// Best template regardless of threshold — telemetry/diagnostics only (lets the
// punch screen show the live cosine score even when it's BELOW the accept gate,
// so we can read genuine-vs-impostor separation off the device).
export function bestMatch(
  embedding: number[],
): {score: number; name: string; userId: string} | null {
  let bestScore = -1;
  let best: Template | null = null;
  for (const tmpl of templateCache) {
    const score = cosineSimilarity(embedding, tmpl.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = tmpl;
    }
  }
  return best ? {score: bestScore, name: best.name, userId: best.userId} : null;
}
