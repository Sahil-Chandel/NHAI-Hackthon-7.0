import React, {useEffect, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import {useNavigation, CommonActions} from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {useSession} from '../../auth/sessionStore';
import {usePunchStatus} from '../../hooks/usePunchStatus';
import WorkerTabBar from '../../components/WorkerTabBar';
import {
  subscribeUnsyncedCount,
  getCurrentUnsyncedCount,
} from '../../../sync/punchSyncWorker';

// Mockup palette (light) + AAA high-contrast variant.
const LIGHT = {
  bg: '#FAFAFA',
  text: '#111114',
  sub: '#5C5C66',
  onlineBg: '#E3F4E7',
  onlineText: '#0D6E2B', // WCAG AA on the mint badge (#15803D was 4.4:1)
  offlineBg: '#FBE7D4',
  offlineText: '#9A4E16',
  green: '#3E9B3A',
  greenText: '#FFFFFF',
  red: '#B5362A',
  redText: '#FFFFFF',
  barBorder: '#ECECEF',
  tabActive: '#1D4ED8',
  tabInactive: '#3A3A40',
};
const AAA: typeof LIGHT = {
  bg: '#000000',
  text: '#FFFFFF',
  sub: '#FFD700',
  onlineBg: '#06210f',
  onlineText: '#00FF66',
  offlineBg: '#241600',
  offlineText: '#FFA500',
  green: '#00B548',
  greenText: '#000000',
  red: '#FF4D4D',
  redText: '#000000',
  barBorder: '#332b00',
  tabActive: '#FFD700',
  tabInactive: '#FFA500',
};

// Visible build tag so the running bundle is identifiable on-device (lets us
// confirm a new APK actually replaced the old one). Bump on every rebuild.
const BUILD_TAG = 'build: THR78-0605';

// ---- Crisp, tintable icons drawn without an icon library ----
function LoginArrow({color}: {color: string}) {
  return (
    <View style={ic.la}>
      <View style={[ic.laDoor, {borderColor: color}]} />
      <View style={[ic.laShaft, {backgroundColor: color}]} />
      <View style={[ic.laHead, {borderColor: color}]} />
    </View>
  );
}
export default function PunchScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const P = isAAA ? AAA : LIGHT;

  const role = useSession(s => s.role);
  const worker = useSession(s => s.worker);
  const token = useSession(s => s.token);
  const tokenExpiresAt = useSession(s => s.tokenExpiresAt);
  const isExpired = useSession(s => s.isExpired);
  const logout = useSession(s => s.logout);
  const hydrated = useSession(s => s.hydrated);
  const status = usePunchStatus(worker?.id);

  const [pending, setPending] = useState<number>(() => getCurrentUnsyncedCount());
  const [online, setOnline] = useState(true);

  // Live pending-sync count (no auto-sync — the worker uploads explicitly).
  useEffect(() => subscribeUnsyncedCount(setPending), []);

  // Live connectivity for the Online/Offline badge.
  useEffect(() => {
    const apply = (s: {isConnected: boolean | null; isInternetReachable: boolean | null}) =>
      setOnline(s.isConnected === true && s.isInternetReachable !== false);
    NetInfo.fetch().then(apply);
    return NetInfo.addEventListener(apply);
  }, []);

  // Guard: if the worker session disappears/expires, return to Welcome.
  useEffect(() => {
    if (!hydrated) return;
    if (role !== 'worker' || !worker || !token || isExpired()) {
      if (role !== null) logout().catch(() => {});
      navigation.dispatch(
        CommonActions.reset({index: 0, routes: [{name: 'Welcome'}]}),
      );
    }
    // tokenExpiresAt drives isExpired(); depend on it so a mid-session expiry
    // re-runs the guard instead of waiting for the next punch/sync action.
  }, [hydrated, role, worker, token, tokenExpiresAt, isExpired, logout, navigation]);

  if (!worker) {
    return (
      <SafeAreaView style={[styles.safe, {backgroundColor: P.bg, justifyContent: 'center'}]}>
        <ActivityIndicator color={P.tabActive} size="large" />
      </SafeAreaView>
    );
  }

  const handleLogout = () => {
    Alert.alert(
      t('punch.logout_title', 'Logout?'),
      t('punch.logout_msg', 'You will need to log in again.'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.confirm'),
          onPress: async () => {
            await logout();
            navigation.dispatch(
              CommonActions.reset({index: 0, routes: [{name: 'Welcome'}]}),
            );
          },
        },
      ],
    );
  };

  const handlePunchIn = () => {
    if (status.kind === 'punched_in') {
      Alert.alert(t('punch.already_in', 'Already punched in'));
      return;
    }
    if (status.kind === 'completed') {
      Alert.alert(
        t('punch.day_complete_title', 'Day complete'),
        t('punch.day_complete_msg', 'You have already punched out today. Come back tomorrow.'),
      );
      return;
    }
    navigation.navigate('PunchCapture', {type: 'in'});
  };

  const handlePunchOut = () => {
    if (status.kind !== 'punched_in') {
      Alert.alert(t('punch.not_in', 'Punch in first before punching out'));
      return;
    }
    navigation.navigate('PunchCapture', {type: 'out'});
  };

  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: P.bg}]}>
      <StatusBar
        barStyle={isAAA ? 'light-content' : 'dark-content'}
        backgroundColor={P.bg}
      />
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}>
          {/* Header: title (long-press = logout) + connectivity badge */}
          <View style={styles.header}>
            <TouchableOpacity
              activeOpacity={0.7}
              onLongPress={handleLogout}
              delayLongPress={500}>
              <Text style={[styles.title, {color: P.text}]} numberOfLines={1}>
                {t('worker_home.title', 'Datalake 3.0')}
              </Text>
            </TouchableOpacity>
            <View
              style={[
                styles.netBadge,
                {backgroundColor: online ? P.onlineBg : P.offlineBg},
              ]}>
              <Text
                style={[
                  styles.netBadgeText,
                  {color: online ? P.onlineText : P.offlineText},
                ]}>
                {online
                  ? t('worker_home.online', 'Online')
                  : t('worker_home.offline', 'Offline')}
              </Text>
            </View>
          </View>
          <Text style={[styles.buildTag, {color: P.sub}]}>{BUILD_TAG}</Text>

          {/* Pending sync */}
          <View style={styles.pendingWrap}>
            <Text style={[styles.pendingLabel, {color: P.text}]}>
              {t('worker_home.pending', 'Pending sync')}
            </Text>
            <Text style={[styles.pendingNum, {color: P.text}]}>{pending}</Text>
            <Text style={[styles.pendingSub, {color: P.sub}]}>
              {t('worker_home.records_queued', 'records queued')}
            </Text>
          </View>

          {/* Punch In / Out — the invalid action for the current status dims
              (but stays tappable so its guard alert still explains why). */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.punchBtn, {backgroundColor: P.green, opacity: status.kind === 'idle' ? 1 : 0.45}]}
            onPress={handlePunchIn}>
            <View style={styles.punchIcon}>
              <LoginArrow color={P.greenText} />
            </View>
            <Text style={[styles.punchText, {color: P.greenText}]}>
              {t('worker_home.punch_in', 'Punch In')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.punchBtn, {backgroundColor: P.red, opacity: status.kind === 'punched_in' ? 1 : 0.45}]}
            onPress={handlePunchOut}>
            <View style={styles.punchIcon}>
              <LoginArrow color={P.redText} />
            </View>
            <Text style={[styles.punchText, {color: P.redText}]}>
              {t('worker_home.punch_out', 'Punch Out')}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Bottom bar: Home | Calendar (→ attendance) | Sync (→ status screen) */}
        <WorkerTabBar
          active="home"
          homeLabel={t('worker_home.tab_home', 'Home')}
          calendarLabel={t('worker_home.tab_calendar', 'Calendar')}
          syncLabel={t('worker_home.tab_sync', 'Sync')}
          onCalendarPress={() => navigation.navigate('WorkerCalendar')}
          onSyncPress={() => navigation.navigate('SyncStatus')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  flex: {flex: 1},
  body: {paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  title: {fontSize: 28, fontWeight: '700', letterSpacing: 0.2},
  netBadge: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
  },
  netBadgeText: {fontSize: 16, fontWeight: '700'},
  buildTag: {fontSize: 11, fontWeight: '600', marginTop: 4, opacity: 0.7},
  pendingWrap: {marginTop: 28, marginBottom: 28},
  pendingLabel: {fontSize: 18, fontWeight: '500'},
  pendingNum: {fontSize: 52, fontWeight: '800', lineHeight: 60, marginTop: 2},
  pendingSub: {fontSize: 17, fontWeight: '500'},
  punchBtn: {
    height: 88,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  punchIcon: {position: 'absolute', left: 30},
  punchText: {fontSize: 24, fontWeight: '700', letterSpacing: 0.3},
});

// Login/enter icon for the punch buttons (the tab-bar icons live in WorkerTabBar).
const ic = StyleSheet.create({
  la: {width: 28, height: 26},
  laDoor: {
    position: 'absolute',
    right: 0,
    top: 2,
    width: 11,
    height: 22,
    borderWidth: 2.5,
    borderLeftWidth: 0,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  laShaft: {position: 'absolute', left: 0, top: 11.75, width: 16, height: 2.5, borderRadius: 2},
  laHead: {
    position: 'absolute',
    left: 9,
    top: 8,
    width: 9,
    height: 9,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    transform: [{rotate: '45deg'}],
  },
});
