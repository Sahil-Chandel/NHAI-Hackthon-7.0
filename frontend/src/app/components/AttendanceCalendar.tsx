import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Calendar, type DateData} from 'react-native-calendars';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../theme/ThemeContext';
import {COLORS} from '../theme/aaaTheme';

export type DayStatus = 'full' | 'partial' | 'absent';

export type CalendarDayData = {
  date: string; // YYYY-MM-DD
  status: DayStatus;
  durationMinutes?: number | null;
};

type Props = {
  days: CalendarDayData[];
  onDayPress?: (day: CalendarDayData | null, dateStr: string) => void;
  /**
   * Controls the visible month. Format YYYY-MM. Updating this prop will scroll
   * the calendar to that month. (Internally fed to Calendar's `current` prop.)
   */
  visibleMonth?: string;
  /**
   * Fires when the user navigates the calendar (arrows / swipe). Receives the
   * new month in YYYY-MM format so the host screen can fetch its data.
   */
  onMonthChange?: (monthYYYYMM: string) => void;
};

export default function AttendanceCalendar({
  days,
  onDayPress,
  visibleMonth,
  onMonthChange,
}: Props) {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  // Legend labels need to contrast against the surrounding NHAI gradient when
  // the calendar is hosted in a GlassCard. In AAA mode we already sit on a
  // solid bg, so use the theme text colour.
  const legendColor = isAAA ? c.text : 'rgba(255, 255, 255, 0.85)';

  const markedDates = useMemo(() => {
    const obj: Record<string, any> = {};
    days.forEach(d => {
      const color =
        d.status === 'full' ? c.success : d.status === 'partial' ? c.warning : c.danger;
      obj[d.date] = {
        marked: true,
        dotColor: color,
        selected: false,
        customStyles: {
          container: {backgroundColor: color + '30'},
          text: {color: c.text, fontWeight: '700'},
        },
      };
    });
    return obj;
  }, [days, c.danger, c.success, c.text, c.warning]);

  return (
    <View style={styles.wrap}>
      <Calendar
        current={visibleMonth ? `${visibleMonth}-01` : undefined}
        markedDates={markedDates}
        markingType="custom"
        firstDay={1}
        onDayPress={(d: DateData) => {
          const found = days.find(x => x.date === d.dateString) || null;
          onDayPress?.(found, d.dateString);
        }}
        onMonthChange={(m: DateData) => {
          if (!onMonthChange) return;
          const yyyymm = `${m.year}-${String(m.month).padStart(2, '0')}`;
          onMonthChange(yyyymm);
        }}
        theme={{
          backgroundColor: 'transparent',
          calendarBackground: 'transparent',
          textSectionTitleColor: c.textSecondary,
          dayTextColor: c.text,
          monthTextColor: c.text,
          arrowColor: c.primary,
          textDisabledColor: c.textMuted,
          todayTextColor: c.primary,
          textDayFontWeight: '600',
          textMonthFontWeight: '800',
          textDayHeaderFontWeight: '700',
        }}
      />
      <View style={styles.legend}>
        <Legend color={c.success} label={t('calendar.legend_full', 'Full day')} textColor={legendColor} />
        <Legend color={c.warning} label={t('calendar.legend_partial', 'Partial')} textColor={legendColor} />
        <Legend color={c.danger} label={t('calendar.legend_absent', 'Absent')} textColor={legendColor} />
      </View>
    </View>
  );
}

function Legend({color, label, textColor}: {color: string; label: string; textColor: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, {backgroundColor: color}]} />
      <Text style={[styles.legendLabel, {color: textColor}]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 12},
  legend: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, paddingTop: 8},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 6},
  dot: {width: 10, height: 10, borderRadius: 5},
  legendLabel: {fontSize: 12, fontWeight: '600'},
});
