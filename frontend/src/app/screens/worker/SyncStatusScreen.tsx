import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
} from 'react-native';
import {useNavigation, CommonActions} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {useSession} from '../../auth/sessionStore';
import {formatDate, formatTimeOfDay} from '../../utils/timeCalc';
import WorkerTabBar from '../../components/WorkerTabBar';
import {
  triggerPunchSync,
  subscribeUnsyncedCount,
  getCurrentUnsyncedCount,
} from '../../../sync/punchSyncWorker';

const LAST_SYNC_KEY = '@nhai_last_sync';

const LIGHT = {
  bg: '#FFFFFF',
  text: '#111114',
  sub: '#5C5C66',
  divider: '#ECECEF',
  onlineBg: '#DBEAFE',
  onlineText: '#1D4ED8',
  offlineBg: '#FBE7D4',
  offlineText: '#9A4E16',
  barTrack: '#D6E4FB',
  barFill: '#1D4ED8',
  accent: '#1D4ED8',
  green: '#15803D',
  red: '#DC2626',
  btn: '#1D4ED8',
  btnText: '#FFFFFF',
};
const AAA: typeof LIGHT = {
  bg: '#000000',
  text: '#FFFFFF',
  sub: '#FFD700',
  divider: '#332b00',
  onlineBg: '#1a1a00',
  onlineText: '#FFD700',
  offlineBg: '#241600',
  offlineText: '#FFA500',
  barTrack: '#332b00',
  barFill: '#FFD700',
  accent: '#FFD700',
  green: '#00FF66',
  red: '#FF3333', // AAA 7:1+ on black (was #FF4D4D at 6.4:1)
  btn: '#FFD700',
  btnText: '#000000',
};

export default function SyncStatusScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const P = isAAA ? AAA : LIGHT;

  const logout = useSession(s => s.logout);

  const [pending, setPending] = useState(() => getCurrentUnsyncedCount());
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncTotal, setSyncTotal] = useState(0);
  const [lastResult, setLastResult] = useState<{synced: number; failed: number} | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const busyRef = useRef(false);
  const autoStartedRef = useRef(false);

  // Live pending count + connectivity + persisted last-sync time.
  useEffect(() => subscribeUnsyncedCount(setPending), []);
  useEffect(() => {
    const apply = (s: {isConnected: boolean | null; isInternetReachable: boolean | null}) =>
      setOnline(s.isConnected === true && s.isInternetReachable !== false);
    NetInfo.fetch().then(apply);
    return NetInfo.addEventListener(apply);
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(LAST_SYNC_KEY)
      .then(v => {
        if (v) setLastSyncAt(Number(v));
      })
      .catch(() => {});
  }, []);

  const runSync = useCallback(async () => {
    if (busyRef.current) return;
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      Alert.alert(
        t('sync.no_net_title', 'No internet'),
        t('sync.no_net', 'Connect to a network, then tap Sync again.'),
      );
      return;
    }
    busyRef.current = true;
    setSyncTotal(getCurrentUnsyncedCount());
    setSyncing(true);
    try {
      const res = await triggerPunchSync();
      if (res.authMissing) {
        await logout();
        navigation.dispatch(CommonActions.reset({index: 0, routes: [{name: 'Welcome'}]}));
        return;
      }
      if (!res.skipped) {
        setLastResult({synced: res.synced, failed: res.failed});
        const now = Date.now();
        setLastSyncAt(now);
        AsyncStorage.setItem(LAST_SYNC_KEY, String(now)).catch(() => {});
      }
    } finally {
      busyRef.current = false;
      setSyncing(false);
    }
  }, [logout, navigation, t]);

  // Auto-start once on arrival (the worker tapped "Sync" to get here) — but
  // only when online with something to upload, so it stays worker-initiated.
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    (async () => {
      const net = await NetInfo.fetch();
      if (net.isConnected && getCurrentUnsyncedCount() > 0) runSync();
    })();
  }, [runSync]);

  const uploaded = syncing ? Math.max(0, syncTotal - pending) : 0;
  const progress = syncing && syncTotal > 0 ? Math.min(1, uploaded / syncTotal) : 0;

  const rows: {label: string; value: string; color: string}[] = [
    {
      label: t('sync_status.total_pending', 'Total pending'),
      value: String(syncing ? syncTotal : pending),
      color: P.text,
    },
    {
      label: t('sync_status.purged', 'Purged locally'),
      value: String(syncing ? uploaded : lastResult?.synced ?? 0),
      color: P.green,
    },
    {
      label: t('sync_status.failed', 'Failed'),
      value: String(lastResult?.failed ?? 0),
      color: P.red,
    },
    {
      label: t('sync_status.last_sync', 'Last sync'),
      value: lastSyncAt
        ? `${formatDate(lastSyncAt)} · ${formatTimeOfDay(lastSyncAt)}`
        : t('sync_status.never', 'Never (first time)'),
      color: P.sub,
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: P.bg}]}>
      <StatusBar barStyle={isAAA ? 'light-content' : 'dark-content'} backgroundColor={P.bg} />
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, {color: P.text}]} numberOfLines={1}>
              {t('sync_status.title', 'Sync Status')}
            </Text>
            <View
              style={[styles.netBadge, {backgroundColor: online ? P.onlineBg : P.offlineBg}]}>
              <Text style={[styles.netBadgeText, {color: online ? P.onlineText : P.offlineText}]}>
                {online ? t('worker_home.online', 'Online') : t('worker_home.offline', 'Offline')}
              </Text>
            </View>
          </View>

          {/* Sync state */}
          <View style={styles.stateBlock}>
            {syncing ? (
              <>
                <Text style={[styles.stateTitle, {color: P.text}]}>
                  {t('sync_status.syncing_now', 'Syncing now')}
                </Text>
                <View style={[styles.barTrack, {backgroundColor: P.barTrack}]}>
                  <View
                    style={[styles.barFill, {backgroundColor: P.barFill, width: `${progress * 100}%`}]}
                  />
                </View>
                <Text style={[styles.stateSub, {color: P.accent}]}>
                  {t('sync_status.uploaded', {
                    done: uploaded,
                    total: syncTotal,
                    defaultValue: '{{done}} of {{total}} records uploaded',
                  })}
                </Text>
              </>
            ) : pending === 0 ? (
              <Text style={[styles.stateTitle, {color: P.green}]}>
                ✓ {t('sync_status.all_synced', 'All records synced')}
              </Text>
            ) : (
              <Text style={[styles.stateTitle, {color: P.text}]}>
                {t('sync_status.ready', {count: pending, defaultValue: '{{count}} records ready to sync'})}
              </Text>
            )}
          </View>

          {/* Sync log */}
          <Text style={[styles.logLabel, {color: P.text}]}>
            {t('sync_status.log', 'SYNC LOG')}
          </Text>
          <View>
            {rows.map((r, i) => (
              <View
                key={r.label}
                style={[styles.row, {borderTopColor: P.divider}, i === 0 && {borderTopWidth: 0}]}>
                <Text style={[styles.rowLabel, {color: P.text}]} numberOfLines={1}>
                  {r.label}
                </Text>
                <Text style={[styles.rowValue, {color: r.color}]} numberOfLines={1}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>

          {/* Force sync */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.forceBtn, {backgroundColor: P.btn, opacity: syncing ? 0.6 : 1}]}
            onPress={runSync}
            disabled={syncing}>
            {syncing ? (
              <ActivityIndicator color={P.btnText} />
            ) : (
              <Text style={[styles.forceText, {color: P.btnText}]}>
                {t('sync_status.force', 'Force sync')}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        <WorkerTabBar
          active="sync"
          homeLabel={t('worker_home.tab_home', 'Home')}
          calendarLabel={t('worker_home.tab_calendar', 'Calendar')}
          syncLabel={t('worker_home.tab_sync', 'Sync')}
          onHomePress={() => navigation.navigate('WorkerHome')}
          onCalendarPress={() => navigation.navigate('WorkerCalendar')}
          onSyncPress={runSync}
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
  title: {fontSize: 28, fontWeight: '700', letterSpacing: 0.2, flexShrink: 1},
  netBadge: {paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, marginLeft: 12},
  netBadgeText: {fontSize: 16, fontWeight: '700'},
  stateBlock: {alignItems: 'center', marginTop: 28, marginBottom: 30, gap: 14},
  stateTitle: {fontSize: 20, fontWeight: '700', textAlign: 'center'},
  barTrack: {width: '90%', height: 10, borderRadius: 5, overflow: 'hidden'},
  barFill: {height: '100%', borderRadius: 5},
  stateSub: {fontSize: 17, fontWeight: '700', textAlign: 'center'},
  logLabel: {fontSize: 15, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderTopWidth: 1,
    gap: 12,
  },
  rowLabel: {fontSize: 18, fontWeight: '500', flexShrink: 1},
  rowValue: {fontSize: 18, fontWeight: '700', flexShrink: 1, textAlign: 'right'},
  forceBtn: {height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 28},
  forceText: {fontSize: 19, fontWeight: '800', letterSpacing: 0.3},
});
