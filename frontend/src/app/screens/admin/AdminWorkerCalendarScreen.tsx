import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import GradientBackground from '../../components/GradientBackground';
import GlassCard from '../../components/GlassCard';
import AttendanceCalendar, {
  type CalendarDayData,
} from '../../components/AttendanceCalendar';
import {fetchAttendanceSummary, type AttendanceSummaryDay} from '../../../sync/punchApi';
import {formatTimeOfDay} from '../../utils/timeCalc';
import type {RootStackParamList} from '../../navigation/RootStack';

function currentMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminWorkerCalendarScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'AdminWorkerCalendar'>>();
  const {workerId, workerName} = route.params;
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [summary, setSummary] = useState<AttendanceSummaryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(currentMonthString);

  const load = useCallback(
    async (m: string, isAlive: () => boolean = () => true) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAttendanceSummary(workerId, m);
        if (isAlive()) setSummary(data);
      } catch (e: any) {
        if (isAlive()) setError(e?.message || 'Failed to load');
      } finally {
        if (isAlive()) setLoading(false);
      }
    },
    [workerId],
  );

  // Guard against setState after unmount — this screen is a modal that can be
  // dismissed while the attendance fetch is still in flight.
  useEffect(() => {
    let alive = true;
    load(month, () => alive);
    return () => {
      alive = false;
    };
  }, [load, month]);

  // Memoise derived data so day-tap (setSelectedDate) doesn't re-run filters/
  // reducers over the whole month every render.
  const days: CalendarDayData[] = useMemo(
    () =>
      summary.map(s => ({
        date: s.date,
        status: s.status,
        durationMinutes: s.duration_minutes,
      })),
    [summary],
  );

  const {totalDays, totalMinutes} = useMemo(() => {
    const td = days.filter(d => d.status === 'full').length;
    const tm = summary.reduce((acc, s) => acc + (s.duration_minutes ?? 0), 0);
    return {totalDays: td, totalMinutes: tm};
  }, [days, summary]);

  const selectedDayData = useMemo(
    () => (selectedDate ? summary.find(s => s.date === selectedDate) : null),
    [selectedDate, summary],
  );

  return (
    <GradientBackground variant="nhai">
      <SafeAreaView style={styles.safe}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={[styles.close, {color: '#FFF', fontSize: 28}]}>✕</Text>
          </TouchableOpacity>
          <View style={{flex: 1}}>
            <Text style={[styles.title, {color: '#FFF', fontSize: f.title}]}>{workerName}</Text>
            <Text style={[styles.subtitle, {color: 'rgba(255,255,255,0.8)', fontSize: f.caption}]}>
              {month}
            </Text>
          </View>
          {loading && <ActivityIndicator color="#FFF" />}
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {error && (
            <GlassCard style={styles.errCard}>
              <Text style={{color: '#FCA5A5', textAlign: 'center'}}>{error}</Text>
            </GlassCard>
          )}

          <View style={styles.statsRow}>
            <GlassCard intensity="med" style={styles.statCard}>
              <Text style={[styles.statValue, {color: '#FFF', fontSize: f.title}]}>{totalDays}</Text>
              <Text style={[styles.statLabel, {color: 'rgba(255,255,255,0.75)'}]}>
                {t('admin_wcal.days', 'Days worked')}
              </Text>
            </GlassCard>
            <GlassCard intensity="med" style={styles.statCard}>
              <Text style={[styles.statValue, {color: '#FFF', fontSize: f.title}]}>
                {Math.floor(totalMinutes / 60)}h
              </Text>
              <Text style={[styles.statLabel, {color: 'rgba(255,255,255,0.75)'}]}>
                {t('admin_wcal.hours', 'Total hours')}
              </Text>
            </GlassCard>
          </View>

          <GlassCard intensity="high" style={styles.calCard}>
            <AttendanceCalendar
              days={days}
              visibleMonth={month}
              onMonthChange={setMonth}
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
              <Text style={[styles.modalTitle, {color: '#FFF', fontSize: f.title}]}>
                {selectedDate}
              </Text>
              {!selectedDayData ? (
                <Text style={[styles.modalEmpty, {color: 'rgba(255,255,255,0.75)'}]}>
                  {t('admin_wcal.no_data', 'No attendance recorded')}
                </Text>
              ) : (
                <>
                  {selectedDayData.punch_in && (
                    <Text style={[styles.modalRow, {color: '#FFF'}]}>
                      ⬇ {t('worker_cal.in', 'In')}:{' '}
                      {formatTimeOfDay(new Date(selectedDayData.punch_in).getTime())}
                    </Text>
                  )}
                  {selectedDayData.punch_out && (
                    <Text style={[styles.modalRow, {color: '#FFF'}]}>
                      ⬆ {t('worker_cal.out', 'Out')}:{' '}
                      {formatTimeOfDay(new Date(selectedDayData.punch_out).getTime())}
                    </Text>
                  )}
                  {selectedDayData.duration_minutes != null && (
                    <Text style={[styles.modalDur, {color: '#10B981'}]}>
                      ⏱ {Math.floor(selectedDayData.duration_minutes / 60)}h{' '}
                      {selectedDayData.duration_minutes % 60}m
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  close: {fontWeight: '700'},
  title: {fontWeight: '800'},
  subtitle: {marginTop: 2},
  scroll: {padding: SPACING.lg, paddingTop: 0, paddingBottom: SPACING.xxl},
  statsRow: {flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg},
  statCard: {flex: 1, padding: SPACING.md, alignItems: 'center'},
  statValue: {fontWeight: '900'},
  statLabel: {fontSize: 11, marginTop: 2, textAlign: 'center', fontWeight: '600'},
  calCard: {padding: SPACING.md},
  errCard: {padding: SPACING.md, marginBottom: SPACING.md},
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {padding: SPACING.lg, minWidth: '85%', gap: SPACING.sm},
  modalTitle: {fontWeight: '800', textAlign: 'center', marginBottom: SPACING.sm},
  modalRow: {fontSize: 16, fontWeight: '600'},
  modalDur: {fontSize: 18, fontWeight: '800', marginTop: SPACING.xs},
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
