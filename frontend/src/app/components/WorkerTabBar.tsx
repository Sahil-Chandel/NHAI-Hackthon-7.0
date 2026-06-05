import React from 'react';
import {StyleSheet, Text, View, TouchableOpacity} from 'react-native';
import {useThemeContext} from '../theme/ThemeContext';

// Shared worker bottom bar (Home + Sync). Per the mockups, Sync is always the
// accent (blue/gold) item and Home is neutral, on both screens.
const PAL = {
  light: {accent: '#1D4ED8', neutral: '#3A3A40', border: '#ECECEF'},
  aaa: {accent: '#FFD700', neutral: '#FFA500', border: '#332b00'},
};

function HomeIcon({color}: {color: string}) {
  return (
    <View style={s.home}>
      <View style={[s.homeRoof, {borderBottomColor: color}]} />
      <View style={[s.homeBody, {backgroundColor: color}]} />
    </View>
  );
}
function SyncIcon({color}: {color: string}) {
  // Clean refresh glyph — the hand-drawn ring + arrowhead read as a broken
  // circle on-device.
  return <Text style={[s.syncGlyph, {color}]}>↻</Text>;
}
function CalendarIcon({color}: {color: string}) {
  return (
    <View style={s.cal}>
      <View style={[s.calRing, s.calRingL, {backgroundColor: color}]} />
      <View style={[s.calRing, s.calRingR, {backgroundColor: color}]} />
      <View style={[s.calBody, {borderColor: color}]} />
      <View style={[s.calHeader, {backgroundColor: color}]} />
    </View>
  );
}

type Props = {
  homeLabel: string;
  syncLabel: string;
  calendarLabel?: string;
  /** Which tab is the current screen — only that tab is highlighted (accent).
   *  Without it every tab is neutral, so nothing looks pre-selected. */
  active?: 'home' | 'calendar' | 'sync';
  onHomePress?: () => void;
  onHomeLongPress?: () => void;
  onCalendarPress?: () => void;
  onSyncPress?: () => void;
  onSyncLongPress?: () => void;
};

export default function WorkerTabBar({
  homeLabel,
  syncLabel,
  calendarLabel,
  active,
  onHomePress,
  onHomeLongPress,
  onCalendarPress,
  onSyncPress,
  onSyncLongPress,
}: Props) {
  const {isAAA} = useThemeContext();
  const p = isAAA ? PAL.aaa : PAL.light;
  // Only the current tab gets the accent colour; the rest are neutral so the
  // bar never looks like a tab is "clicked" when it isn't.
  const homeColor = active === 'home' ? p.accent : p.neutral;
  const calColor = active === 'calendar' ? p.accent : p.neutral;
  const syncColor = active === 'sync' ? p.accent : p.neutral;
  return (
    <View style={[s.bar, {borderTopColor: p.border}]}>
      <TouchableOpacity
        style={s.tab}
        activeOpacity={0.7}
        onPress={onHomePress}
        onLongPress={onHomeLongPress}
        delayLongPress={400}>
        <HomeIcon color={homeColor} />
        <Text style={[s.label, {color: homeColor}]} numberOfLines={1}>
          {homeLabel}
        </Text>
      </TouchableOpacity>
      {/* Calendar tab — only rendered when a handler is wired, so callers that
          don't need it keep the original 2-tab layout. */}
      {onCalendarPress && (
        <TouchableOpacity style={s.tab} activeOpacity={0.7} onPress={onCalendarPress}>
          <CalendarIcon color={calColor} />
          <Text style={[s.label, {color: calColor}]} numberOfLines={1}>
            {calendarLabel}
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={s.tab}
        activeOpacity={0.7}
        onPress={onSyncPress}
        onLongPress={onSyncLongPress}>
        <SyncIcon color={syncColor} />
        <Text style={[s.label, {color: syncColor}]} numberOfLines={1}>
          {syncLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {flexDirection: 'row', borderTopWidth: 1, paddingTop: 12, paddingBottom: 8},
  tab: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4, minHeight: 56},
  label: {fontSize: 15, fontWeight: '600'},
  home: {width: 26, height: 24, alignItems: 'center', justifyContent: 'center'},
  homeRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  homeBody: {width: 17, height: 11, marginTop: -1, borderBottomLeftRadius: 2, borderBottomRightRadius: 2},
  syncGlyph: {fontSize: 24, fontWeight: '700', lineHeight: 26, height: 24, textAlignVertical: 'center'},
  cal: {width: 24, height: 24, alignItems: 'center', justifyContent: 'flex-end'},
  calBody: {width: 21, height: 18, borderWidth: 2.5, borderRadius: 4},
  calHeader: {position: 'absolute', bottom: 12, width: 16, height: 4, borderRadius: 1},
  calRing: {position: 'absolute', top: 0, width: 2.5, height: 6, borderRadius: 1.5},
  calRingL: {left: 6},
  calRingR: {right: 6},
});
