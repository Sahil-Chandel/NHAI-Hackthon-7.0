import React, {useEffect} from 'react';
import {StyleSheet, Text, View, TouchableOpacity, SafeAreaView} from 'react-native';
import {useNavigation, useRoute, type RouteProp, CommonActions} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import GradientBackground from '../../components/GradientBackground';
import GlassCard from '../../components/GlassCard';
import {formatTimeOfDay} from '../../utils/timeCalc';
import {useSession} from '../../auth/sessionStore';
import type {RootStackParamList} from '../../navigation/RootStack';

export default function PunchResultScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'PunchResult'>>();
  const {success, type, timestamp, reason, gpsAvailable} = route.params ?? {success: false, type: 'in'};
  const workerName = useSession(s => s.worker?.name);
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  // Auto-dismiss success after 4s
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => {
        navigation.dispatch(
          CommonActions.reset({index: 0, routes: [{name: 'WorkerHome'}]}),
        );
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [success, navigation]);

  const variant = success ? 'success' : 'danger';
  const emoji = success ? '✅' : '❌';
  const title = success
    ? type === 'in'
      ? t('punch_result.success_in', 'Punched In!')
      : t('punch_result.success_out', 'Punched Out!')
    : t('punch_result.failed', 'Verification Failed');

  return (
    <GradientBackground variant={variant} respectAAA={false}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>{emoji}</Text>

          <GlassCard intensity="high" style={styles.card}>
            <Text style={[styles.title, {fontSize: f.titleLg, color: '#FFF'}]}>{title}</Text>

            {success && workerName && (
              <Text
                style={[styles.verified, {fontSize: f.body, color: '#FFF'}]}
                numberOfLines={1}>
                {t('punch_result.verified', '✓ Verified')} · {workerName}
              </Text>
            )}

            {success && timestamp && (
              <>
                <Text style={[styles.time, {fontSize: f.title, color: '#FFF'}]}>
                  {formatTimeOfDay(timestamp)}
                </Text>
                <Text style={[styles.subtle, {fontSize: f.body, color: 'rgba(255,255,255,0.85)'}]}>
                  {gpsAvailable
                    ? `📍 ${t('punch_result.gps_ok', 'Location captured')}`
                    : `⚠ ${t('punch_result.gps_missing', 'Location unavailable')}`}
                </Text>
                <Text style={[styles.subtle, {fontSize: f.caption, color: 'rgba(255,255,255,0.75)', marginTop: SPACING.md}]}>
                  {t('punch_result.synced_later', 'Saved offline — will sync automatically')}
                </Text>
              </>
            )}

            {!success && (
              <>
                <Text style={[styles.subtle, {fontSize: f.body, color: 'rgba(255,255,255,0.9)'}]}>
                  {reason === 'face_mismatch'
                    ? t('punch_result.r_face', 'Face did not match your enrolled profile')
                    : reason === 'timeout'
                      ? t('punch_result.r_timeout', 'Could not detect face. Try better lighting.')
                      : reason === 'spoof'
                        ? t('punch_result.r_spoof', 'Spoof attempt detected')
                        : t('punch_result.r_generic', 'Something went wrong')}
                </Text>
              </>
            )}
          </GlassCard>

          {!success && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, {backgroundColor: 'rgba(255,255,255,0.2)', borderColor: '#FFF'}]}
                onPress={() => navigation.replace('PunchCapture', {type})}>
                <Text style={[styles.btnText, {color: '#FFF', fontSize: f.action}]}>
                  {t('common.retry', 'Retry')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, {backgroundColor: '#FFF'}]}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.reset({index: 0, routes: [{name: 'WorkerHome'}]}),
                  )
                }>
                <Text style={[styles.btnText, {color: '#000', fontSize: f.action}]}>
                  {t('common.back', 'Back')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {success && (
            <TouchableOpacity
              onPress={() =>
                navigation.dispatch(
                  CommonActions.reset({index: 0, routes: [{name: 'WorkerHome'}]}),
                )
              }>
              <Text style={[styles.dismiss, {color: 'rgba(255,255,255,0.85)', fontSize: f.body}]}>
                {t('punch_result.tap_to_return', 'Tap to return')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    gap: SPACING.lg,
  },
  bigEmoji: {fontSize: 120},
  card: {padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm, minWidth: '90%', maxWidth: 500},
  title: {fontWeight: '800', textAlign: 'center'},
  verified: {fontWeight: '700', textAlign: 'center', marginTop: SPACING.xs},
  time: {fontWeight: '900', marginTop: SPACING.sm},
  subtle: {textAlign: 'center'},
  actions: {flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg},
  btn: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  btnText: {fontWeight: '800'},
  dismiss: {marginTop: SPACING.lg, fontWeight: '600'},
});
