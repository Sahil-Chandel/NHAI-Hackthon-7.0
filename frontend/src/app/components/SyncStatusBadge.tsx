import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, ActivityIndicator, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../theme/ThemeContext';
import {COLORS, FONTS, RADIUS, SPACING} from '../theme/aaaTheme';
import {
  subscribeUnsyncedCount,
  triggerPunchSync,
  getCurrentUnsyncedCount,
} from '../../sync/punchSyncWorker';

export default function SyncStatusBadge() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [count, setCount] = useState<number>(() => getCurrentUnsyncedCount());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsub = subscribeUnsyncedCount(n => setCount(n));
    return unsub;
  }, []);

  const onPress = async () => {
    if (syncing || count === 0) return;
    setSyncing(true);
    try {
      await triggerPunchSync();
    } finally {
      setSyncing(false);
    }
  };

  const synced = count === 0;
  const bg = synced ? c.success : c.warning;
  // AAA success/warning are light (neon green / amber) → white is unreadable;
  // use black foreground in AAA, matching aaaTheme.actionButtonText.
  const fg = isAAA ? '#000' : '#FFF';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={syncing || synced}
      style={[styles.badge, {backgroundColor: bg, borderColor: c.border}]}>
      {syncing ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[styles.badgeText, {color: fg, fontSize: f.caption}]}>
          {synced
            ? `✓ ${t('sync.all_synced', 'Synced')}`
            : `⏳ ${t('sync.pending_count', {count, defaultValue: '{{count}} pending'})}`}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    minHeight: 28,
    maxWidth: 160,
    justifyContent: 'center',
  },
  badgeText: {fontWeight: '700'},
});
