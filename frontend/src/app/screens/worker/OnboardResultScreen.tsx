import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
  CommonActions,
} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import type {RootStackParamList} from '../../navigation/RootStack';

// Mockup palette (light) + an AAA high-contrast variant so the screen stays
// usable in outdoor/accessibility mode instead of flashing pure white.
const LIGHT = {
  bg: '#FFFFFF',
  text: '#111114',
  sub: '#6B7280',
  divider: '#ECECEF',
  ringBorder: '#BFE0B6',
  ringBg: '#EAF5E6',
  check: '#2E7D32',
  badgeBg: '#E7F5EA',
  badgeText: '#15803D',
  blue: '#1D4ED8',
  blueTile: '#E6ECFC',
  green: '#15803D', // WCAG AA on white (the lighter #1F8A3B was 4.4:1)
  greenTile: '#E7F5EA',
  orange: '#B45309', // WCAG AA on white
  orangeTile: '#FBEEDD',
  btn: '#1D4ED8',
  btnText: '#FFFFFF',
};
const AAA: typeof LIGHT = {
  bg: '#000000',
  text: '#FFFFFF',
  sub: '#FFD700',
  divider: '#2a2400',
  ringBorder: '#00FF66',
  ringBg: '#06210f',
  check: '#00FF66',
  badgeBg: '#06210f',
  badgeText: '#00FF66',
  blue: '#FFD700',
  blueTile: '#1a1a00',
  green: '#00FF66',
  greenTile: '#06210f',
  orange: '#FFA500',
  orangeTile: '#241600',
  btn: '#FFD700',
  btnText: '#000000',
};

// Worker registry ids are uuids/ints; present them as a clean "NHAI-####" code.
function formatId(raw?: string): string {
  if (!raw) return '';
  const cleaned = String(raw).replace(/[^A-Za-z0-9]/g, '');
  if (!cleaned) return '';
  if (/^\d+$/.test(cleaned)) return `NHAI-${cleaned}`;
  return `NHAI-${cleaned.slice(-4).toUpperCase()}`;
}

type IconKind = 'score' | 'liveness' | 'time' | 'sync';

// Crisp, tintable mini-icons drawn without an icon library.
function RowIcon({kind, color}: {kind: IconKind; color: string}) {
  if (kind === 'score') {
    return (
      <View style={styles.barsWrap}>
        <View style={[styles.bar, {height: 9, backgroundColor: color}]} />
        <View style={[styles.bar, {height: 16, backgroundColor: color}]} />
        <View style={[styles.bar, {height: 12, backgroundColor: color}]} />
      </View>
    );
  }
  if (kind === 'time') {
    return (
      <View style={[styles.clock, {borderColor: color}]}>
        <View style={[styles.handMin, {backgroundColor: color}]} />
        <View style={[styles.handHr, {backgroundColor: color}]} />
      </View>
    );
  }
  return (
    <Text style={[styles.glyph, {color}]}>{kind === 'liveness' ? '✓' : '↻'}</Text>
  );
}

export default function OnboardResultScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'OnboardResult'>>();
  const p = route.params;
  const P = isAAA ? AAA : LIGHT;

  const name = p?.name ?? '';
  const displayId = formatId(p?.workerId);
  const score = typeof p?.matchScore === 'number' ? p.matchScore : undefined;
  const elapsed =
    typeof p?.elapsedMs === 'number' ? Math.max(0, Math.round(p.elapsedMs)) : undefined;
  const liveness = p?.livenessPassed ?? true;
  const synced = p?.synced ?? true;

  const goHome = () =>
    navigation.dispatch(
      CommonActions.reset({index: 0, routes: [{name: 'WorkerHome'}]}),
    );

  const rows: {
    kind: IconKind;
    tile: string;
    color: string;
    label: string;
    value: string;
  }[] = [
    {
      kind: 'score',
      tile: P.blueTile,
      color: P.blue,
      label: t('onboard_result.match_score', 'Match score'),
      value: score != null ? score.toFixed(3) : '—',
    },
    {
      kind: 'liveness',
      tile: liveness ? P.greenTile : P.orangeTile,
      color: liveness ? P.green : P.orange,
      label: t('onboard_result.liveness', 'Liveness'),
      value: liveness
        ? t('onboard_result.passed', 'Passed')
        : t('onboard_result.failed', 'Failed'),
    },
    {
      kind: 'time',
      tile: P.blueTile,
      color: P.blue,
      label: t('onboard_result.time_taken', 'Time taken'),
      value: elapsed != null ? `${elapsed} ms` : '—',
    },
    {
      kind: 'sync',
      tile: synced ? P.greenTile : P.orangeTile,
      color: synced ? P.green : P.orange,
      label: t('onboard_result.sync', 'Profile sync'),
      value: synced
        ? t('onboard_result.synced', 'Synced')
        : t('onboard_result.queued', 'Queued'),
    },
  ];

  return (
    <View style={[styles.screen, {backgroundColor: P.bg}]}>
      <StatusBar
        barStyle={isAAA ? 'light-content' : 'dark-content'}
        backgroundColor={P.bg}
      />
      <SafeAreaView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, {color: P.text}]}>
            {t('onboard_result.title', 'Result')}
          </Text>

          <View
            style={[
              styles.ring,
              {borderColor: P.ringBorder, backgroundColor: P.ringBg},
            ]}>
            <Text style={[styles.ringCheck, {color: P.check}]}>✓</Text>
          </View>

          <Text
            style={[styles.name, {color: P.text}]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {name}
          </Text>
          {!!displayId && (
            <Text style={[styles.id, {color: P.sub}]}>
              {t('onboard_result.id', 'ID')}: {displayId}
            </Text>
          )}

          <View style={[styles.badge, {backgroundColor: P.badgeBg}]}>
            <Text style={[styles.badgeCheck, {color: P.badgeText}]}>✓</Text>
            <Text style={[styles.badgeText, {color: P.badgeText}]}>
              {t('onboard_result.authenticated', 'Authenticated')}
            </Text>
          </View>

          <Text style={[styles.sectionLabel, {color: P.text}]}>
            {t('onboard_result.details', 'CONFIDENCE DETAILS')}
          </Text>

          <View style={styles.rows}>
            {rows.map((r, i) => (
              <View
                key={r.kind}
                style={[
                  styles.row,
                  i > 0 && {borderTopWidth: 1, borderTopColor: P.divider},
                ]}>
                <View style={[styles.tile, {backgroundColor: r.tile}]}>
                  <RowIcon kind={r.kind} color={r.color} />
                </View>
                <Text
                  style={[styles.rowLabel, {color: P.text}]}
                  numberOfLines={1}>
                  {r.label}
                </Text>
                <Text
                  style={[styles.rowValue, {color: r.color}]}
                  numberOfLines={1}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.bottom}>
            <TouchableOpacity
              style={[styles.doneBtn, {backgroundColor: P.btn}]}
              onPress={goHome}
              activeOpacity={0.85}>
              <Text style={[styles.doneText, {color: P.btnText}]}>
                {t('onboard_result.done', 'Done')}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  flex: {flex: 1},
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 28,
    alignItems: 'center',
  },
  title: {fontSize: 28, fontWeight: '700', marginBottom: 18, letterSpacing: 0.3},
  ring: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCheck: {fontSize: 52, fontWeight: '800', marginTop: -4},
  name: {fontSize: 26, fontWeight: '800', marginTop: 16, textAlign: 'center'},
  id: {fontSize: 15, marginTop: 4, fontWeight: '500'},
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 18,
  },
  badgeCheck: {fontSize: 17, fontWeight: '900'},
  badgeText: {fontSize: 18, fontWeight: '700'},
  sectionLabel: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 28,
    marginBottom: 6,
  },
  rows: {alignSelf: 'stretch'},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 14},
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {flex: 1, fontSize: 17, fontWeight: '500'},
  rowValue: {fontSize: 17, fontWeight: '700'},
  glyph: {fontSize: 20, fontWeight: '900'},
  barsWrap: {flexDirection: 'row', alignItems: 'flex-end', height: 18, gap: 2},
  bar: {width: 4, borderRadius: 1},
  clock: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two hands meeting at the clock centre (10,10): minute points up, hour right.
  handMin: {position: 'absolute', width: 2, height: 7, left: 9, top: 3, borderRadius: 1},
  handHr: {position: 'absolute', width: 5, height: 2, left: 10, top: 9, borderRadius: 1},
  bottom: {alignSelf: 'stretch', marginTop: 'auto', paddingTop: 24},
  doneBtn: {height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  doneText: {fontSize: 19, fontWeight: '800', letterSpacing: 0.3},
});
