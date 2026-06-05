import React, {useMemo, useState, useCallback, useRef, useEffect} from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import GradientBackground from '../../components/GradientBackground';
import GlassCard from '../../components/GlassCard';
import AttendanceCalendar, {
  type CalendarDayData,
  type DayStatus,
} from '../../components/AttendanceCalendar';
import {useSession} from '../../auth/sessionStore';
import {
  getEventsBetween,
  type PunchEventRow,
} from '../../../storage/db/punchEvents.repo';
import {fetchMyPunches} from '../../../sync/punchApi';
import {
  formatTimeOfDay,
  calculateDuration,
  startOfMonth,
  endOfMonth,
} from '../../utils/timeCalc';

function dayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function summarize(events: PunchEventRow[]): CalendarDayData[] {
  const byDay = new Map<string, PunchEventRow[]>();
  events.forEach(ev => {
    const key = dayKeyFromMs(ev.timestamp);
    const arr = byDay.get(key) ?? [];
    arr.push(ev);
    byDay.set(key, arr);
  });
  const out: CalendarDayData[] = [];
  byDay.forEach((arr, date) => {
    let punchIn: PunchEventRow | undefined;
    let punchOut: PunchEventRow | undefined;
    for (const e of arr) {
      // earliest 'in' (arr is timestamp-ascending) and latest 'out' so the
      // worked span covers the whole day, not just the last in/out cycle.
      if (e.type === 'in') {
        if (!punchIn) punchIn = e;
      } else if (e.type === 'out') {
        punchOut = e;
      }
    }
    let status: DayStatus = 'absent';
    let dur: number | null = null;
    if (punchIn && punchOut && punchOut.timestamp > punchIn.timestamp) {
      status = 'full';
      dur = Math.floor((punchOut.timestamp - punchIn.timestamp) / 60000);
    } else if (punchIn) {
      status = 'partial';
    }
    out.push({date, status, durationMinutes: dur});
  });
  return out;
}

function currentMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function WorkerCalendarScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const worker = useSession(s => s.worker);
  const [events, setEvents] = useState<PunchEventRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<string>(currentMonthString);
  // Latest selected month — lets an async loadRemote discard its result if the
  // user switched months while it was in flight (avoids stale-month merge).
  const monthRef = useRef(month);
  useEffect(() => {
    monthRef.current = month;
  }, [month]);

  // --- Loaders -----------------------------------------------------------
  // Both `loadLocal` and `loadRemote` depend ONLY on (workerId, month) — never
  // on `events`. Putting `events` into the deps array would recreate these
  // callbacks each time `setEvents` fires, which (combined with useFocusEffect
  // re-running on identity change) used to cause an infinite re-fetch loop.

  const loadLocal = useCallback(
    (m: string) => {
      if (!worker) return;
      const [yStr, mStr] = m.split('-');
      const y = Number(yStr);
      const mo = Number(mStr);
      const from = startOfMonth(y, mo);
      const to = endOfMonth(y, mo);
      try {
        setEvents(getEventsBetween(worker.id, from, to));
      } catch {
        setEvents([]);
      }
    },
    [worker],
  );

  const loadRemote = useCallback(
    async (m: string) => {
      if (!worker) return;
      setLoading(true);
      try {
        const [yStr, mStr] = m.split('-');
        const y = Number(yStr);
        const mo = Number(mStr);
        const from = new Date(y, mo - 1, 1).toISOString();
        const to = new Date(y, mo, 1).toISOString();
        const remote = await fetchMyPunches({
          date_from: from,
          date_to: to,
          limit: 1000,
        });
        const rows: PunchEventRow[] = remote.map(r => ({
          id: r.id,
          workerId: r.worker_id,
          type: r.type,
          timestamp: new Date(r.timestamp).getTime(),
          gpsLat: r.gps_lat,
          gpsLon: r.gps_lon,
          gpsAccuracy: null,
          faceMatchScore: r.face_match_score,
          livenessPassed: r.liveness_passed,
          deviceId: null,
          synced: true,
          syncAttempts: 0,
          lastSyncError: null,
          createdAt: new Date(r.created_at).getTime(),
        }));
        // Discard if the user switched months while this fetch was in flight,
        // otherwise the old month's rows merge into the new month's state.
        if (m !== monthRef.current) return;
        // Merge: prefer locally-tracked entries (unsynced) over remote copies.
        // Uses functional setState so we read the FRESHEST prev state without
        // declaring `events` as a dep.
        setEvents(prev => {
          const map = new Map<string, PunchEventRow>();
          prev.forEach(e => map.set(e.id, e));
          rows.forEach(e => {
            if (!map.has(e.id)) map.set(e.id, e);
          });
          return Array.from(map.values()).sort(
            (a, b) => a.timestamp - b.timestamp,
          );
        });
      } catch {
        // ignore — local data still shows
      } finally {
        setLoading(false);
      }
    },
    [worker],
  );

  useFocusEffect(
    useCallback(() => {
      loadLocal(month);
      loadRemote(month).catch(() => {});
    }, [loadLocal, loadRemote, month]),
  );

  const onMonthChange = useCallback(
    (nextMonth: string) => {
      setMonth(nextMonth);
      // useFocusEffect dep on `month` will retrigger loaders.
    },
    [],
  );

  // --- Derived data (memoised so we don't re-compute on every render) ----

  const days = useMemo(() => summarize(events), [events]);

  const {totalDays, totalMinutes, avgMinutes} = useMemo(() => {
    const td = days.filter(d => d.status === 'full').length;
    const tm = days.reduce((s, d) => s + (d.durationMinutes ?? 0), 0);
    const am = td > 0 ? Math.floor(tm / td) : 0;
    return {totalDays: td, totalMinutes: tm, avgMinutes: am};
  }, [days]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [] as PunchEventRow[];
    return events.filter(e => dayKeyFromMs(e.timestamp) === selectedDate);
  }, [selectedDate, events]);

  const selectedDaySummary = useMemo(() => {
    let punchIn: PunchEventRow | undefined;
    let punchOut: PunchEventRow | undefined;
    for (const e of selectedDayEvents) {
      // earliest 'in', latest 'out' — see summarize()
      if (e.type === 'in') {
        if (!punchIn) punchIn = e;
      } else if (e.type === 'out') {
        punchOut = e;
      }
    }
    const dur =
      punchIn && punchOut && punchOut.timestamp > punchIn.timestamp
        ? calculateDuration(punchIn.timestamp, punchOut.timestamp)
        : null;
    return {punchIn, punchOut, dur};
  }, [selectedDayEvents]);

  return (
    <GradientBackground variant="nhai">
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={[styles.back, {color: '#FFF', fontSize: f.body}]}>‹ {t('common.back')}</Text>
            </TouchableOpacity>
            {loading && <ActivityIndicator color="#FFF" />}
          </View>

          <Text style={[styles.title, {color: '#FFF', fontSize: f.titleLg}]}>
            {t('worker_cal.title', 'My Attendance')}
          </Text>

          <View style={styles.statsRow}>
            <GlassCard intensity="med" style={styles.statCard}>
              <Text
                style={[styles.statValue, {color: '#FFF', fontSize: f.title}]}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {totalDays}
              </Text>
              <Text style={[styles.statLabel, {color: 'rgba(255,255,255,0.75)'}]}>
                {t('worker_cal.full_days', 'Full days')}
              </Text>
            </GlassCard>
            <GlassCard intensity="med" style={styles.statCard}>
              <Text
                style={[styles.statValue, {color: '#FFF', fontSize: f.title}]}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {Math.floor(totalMinutes / 60)}h
              </Text>
              <Text style={[styles.statLabel, {color: 'rgba(255,255,255,0.75)'}]}>
                {t('worker_cal.total_hours', 'Total hours')}
              </Text>
            </GlassCard>
            <GlassCard intensity="med" style={styles.statCard}>
              <Text
                style={[styles.statValue, {color: '#FFF', fontSize: f.title}]}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {Math.floor(avgMinutes / 60)}h {avgMinutes % 60}m
              </Text>
              <Text style={[styles.statLabel, {color: 'rgba(255,255,255,0.75)'}]}>
                {t('worker_cal.avg', 'Avg/day')}
              </Text>
            </GlassCard>
          </View>

          <GlassCard intensity="high" style={styles.calCard}>
            <AttendanceCalendar
              days={days}
              visibleMonth={month}
              onMonthChange={onMonthChange}
              onDayPress={(_d, dateStr) => setSelectedDate(dateStr)}
            />
          </GlassCard>
        </ScrollView>

        <Modal
          visible={!!selectedDate}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedDate(null)}>
          <View style={styles.modalBg}>
            <GlassCard intensity="high" style={styles.modalCard}>
              <Text
                style={[styles.modalTitle, {color: '#FFF', fontSize: f.title}]}
                numberOfLines={1}>
                {selectedDate}
              </Text>
              {selectedDayEvents.length === 0 ? (
                <Text style={[styles.modalEmpty, {color: 'rgba(255,255,255,0.75)'}]}>
                  {t('worker_cal.no_data', 'No attendance recorded')}
                </Text>
              ) : (
                <>
                  {selectedDaySummary.punchIn && (
                    <Text style={[styles.modalRow, {color: '#FFF'}]}>
                      ⬇ {t('worker_cal.in', 'In')}:{' '}
                      {formatTimeOfDay(selectedDaySummary.punchIn.timestamp)}
                    </Text>
                  )}
                  {selectedDaySummary.punchOut && (
                    <Text style={[styles.modalRow, {color: '#FFF'}]}>
                      ⬆ {t('worker_cal.out', 'Out')}:{' '}
                      {formatTimeOfDay(selectedDaySummary.punchOut.timestamp)}
                    </Text>
                  )}
                  {selectedDaySummary.dur && (
                    <Text style={[styles.modalDur, {color: '#10B981'}]}>
                      ⏱ {t('worker_cal.duration', 'Worked')}: {selectedDaySummary.dur.formatted}
                    </Text>
                  )}
                  {selectedDaySummary.punchIn &&
                    (selectedDaySummary.punchIn.gpsLat != null ||
                      selectedDaySummary.punchOut?.gpsLat != null) && (
                      <Text style={[styles.modalGps, {color: 'rgba(255,255,255,0.7)'}]} numberOfLines={1}>
                        📍{' '}
                        {(
                          selectedDaySummary.punchIn.gpsLat ??
                          selectedDaySummary.punchOut?.gpsLat
                        )?.toFixed(4)}
                        ,{' '}
                        {(
                          selectedDaySummary.punchIn.gpsLon ??
                          selectedDaySummary.punchOut?.gpsLon
                        )?.toFixed(4)}
                      </Text>
                    )}
                </>
              )}
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setSelectedDate(null)}>
                <Text style={[styles.modalBtnText, {color: '#FFF'}]}>
                  {t('common.back', 'Close')}
                </Text>
              </TouchableOpacity>
            </GlassCard>
          </View>
        </Modal>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  backBtn: {minHeight: 44, justifyContent: 'center'},
  back: {fontWeight: '600'},
  title: {fontWeight: '800', marginTop: SPACING.sm, marginBottom: SPACING.lg},
  statsRow: {flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg},
  statCard: {flex: 1, padding: SPACING.md, alignItems: 'center', overflow: 'hidden'},
  statValue: {fontWeight: '900'},
  statLabel: {fontSize: 11, marginTop: 2, textAlign: 'center', fontWeight: '600'},
  calCard: {padding: SPACING.md},
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {padding: SPACING.lg, minWidth: '85%', maxWidth: '95%', gap: SPACING.sm},
  modalTitle: {fontWeight: '800', textAlign: 'center', marginBottom: SPACING.sm},
  modalRow: {fontSize: 16, fontWeight: '600'},
  modalDur: {fontSize: 18, fontWeight: '800', marginTop: SPACING.xs},
  modalGps: {fontSize: 12, marginTop: SPACING.xs},
  modalEmpty: {textAlign: 'center', padding: SPACING.lg},
  modalBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  modalBtnText: {fontWeight: '700'},
});
