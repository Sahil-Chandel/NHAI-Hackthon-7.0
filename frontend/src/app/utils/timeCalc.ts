export type Duration = {
  hours: number;
  minutes: number;
  totalMinutes: number;
  formatted: string; // "8h 23m"
};

export function calculateDuration(startMs: number, endMs: number): Duration {
  let diff = Math.max(0, endMs - startMs);
  const totalSeconds = Math.floor(diff / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  // Include seconds for sub-hour spans so a short in→out gap (e.g. a quick
  // test punch a few seconds apart) is actually visible instead of "0h 00m".
  let formatted: string;
  if (hours > 0) {
    formatted = `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  } else if (minutes > 0) {
    formatted = `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  } else {
    formatted = `${seconds}s`;
  }
  return {hours, minutes, totalMinutes, formatted};
}

export function formatTimeOfDay(ms: number, locale = 'en-IN'): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(ms: number, locale = 'en-IN'): string {
  return new Date(ms).toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function toIsoString(ms: number): string {
  return new Date(ms).toISOString();
}

export function todayKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isSameDay(a: number, b: number): boolean {
  return todayKey(a) === todayKey(b);
}

export function startOfMonth(year: number, month1To12: number): number {
  return new Date(year, month1To12 - 1, 1).getTime();
}

export function endOfMonth(year: number, month1To12: number): number {
  return new Date(year, month1To12, 1).getTime();
}
