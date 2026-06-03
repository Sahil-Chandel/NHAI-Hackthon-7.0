import React, {useEffect, useMemo} from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import {useNavigation, CommonActions} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../theme/aaaTheme';
import GradientBackground from '../components/GradientBackground';
import GlassCard from '../components/GlassCard';
import {useSession} from '../auth/sessionStore';

export default function WelcomeScreen() {
  const {t, i18n} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const role = useSession(s => s.role);
  const isExpired = useSession(s => s.isExpired);
  const logout = useSession(s => s.logout);
  const hydrated = useSession(s => s.hydrated);

  // Compute what (if anything) we should redirect to. Memoised so the JSX
  // branch knows to hide content during the redirect frame (avoids flash).
  // This is a worker-only app now — Admin was removed; a stale admin session
  // (from a previous build) is cleared rather than redirected.
  const redirectTarget = useMemo<'WorkerHome' | null>(() => {
    if (!hydrated || role === null) return null;
    if (isExpired()) return null;
    if (role === 'worker') return 'WorkerHome';
    return null;
  }, [hydrated, role, isExpired]);

  // Auto-redirect if a worker session exists; auto-logout if expired or stale
  // admin.
  useEffect(() => {
    if (!hydrated) return;

    // Expired session, or a leftover admin session — clear it and stay on
    // Welcome. `logout` is now async (it wipes keychain too); fire-and-forget
    // is OK because we don't navigate away — we just want the cleanup to happen.
    if (role !== null && (isExpired() || role === 'admin')) {
      logout().catch(() => {});
      return;
    }

    if (redirectTarget) {
      navigation.dispatch(
        CommonActions.reset({index: 0, routes: [{name: redirectTarget}]}),
      );
    }
  }, [hydrated, role, isExpired, logout, redirectTarget, navigation]);

  // While we're hydrating or about to redirect, render a lightweight splash
  // (avoids the Welcome UI flashing for returning users)
  if (!hydrated || redirectTarget) {
    return (
      <GradientBackground variant="nhai" respectAAA={true}>
        <SafeAreaView style={[styles.safe, styles.splashCenter]}>
          <ActivityIndicator color="#FFFFFF" size="large" />
        </SafeAreaView>
      </GradientBackground>
    );
  }

  const toggleLang = () => {
    const next = i18n.language?.startsWith('hi') ? 'en' : 'hi';
    i18n.changeLanguage(next);
  };

  return (
    <GradientBackground variant="nhai" respectAAA={true}>
      <SafeAreaView style={styles.safe}>
        {/* Language pill */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={toggleLang}
            style={[styles.langPill, {borderColor: c.border}]}
            accessibilityLabel={t('welcome.toggle_lang_a11y', 'Toggle language')}>
            <Text style={[styles.langText, {color: c.text, fontSize: f.body}]}>
              {i18n.language?.startsWith('hi') ? 'हिं | EN' : 'EN | हिं'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Brand */}
        <View style={styles.brandWrap}>
          <View style={styles.logoCard}>
            <Image
              source={require('../../../assets/National_Highways_Authority_of_India_logo.png')}
              style={styles.logoImg}
              resizeMode="contain"
              accessibilityLabel="NHAI logo"
            />
          </View>
          <Text
            style={[
              styles.title,
              {color: '#FFFFFF', fontSize: f.titleLg, marginTop: SPACING.lg},
            ]}>
            {t('welcome.title', 'NHAI Attendance')}
          </Text>
          <Text
            style={[
              styles.subtitle,
              {color: 'rgba(255,255,255,0.85)', fontSize: f.bodyLg},
            ]}>
            {t('welcome.subtitle', 'Face-verified worker attendance')}
          </Text>
        </View>

        {/* Role card — worker only */}
        <View style={styles.cardsWrap}>
          <GlassCard intensity="high" style={styles.roleCard}>
            <TouchableOpacity
              style={styles.roleInner}
              onPress={() => navigation.navigate('WorkerOnboard')}
              accessibilityRole="button"
              accessibilityLabel={t('welcome.worker_btn', 'Login as Worker')}>
              <Text style={styles.roleEmoji}>👷</Text>
              <View style={{flex: 1}}>
                <Text style={[styles.roleTitle, {color: '#FFF', fontSize: f.title}]}>
                  {t('welcome.worker_btn', 'Login as Worker')}
                </Text>
                <Text
                  style={[
                    styles.roleSub,
                    {color: 'rgba(255,255,255,0.75)', fontSize: f.body},
                  ]}>
                  {t('welcome.worker_hint', 'Verify your details + face to punch in/out')}
                </Text>
              </View>
              <Text style={[styles.arrow, {color: '#FFF', fontSize: f.titleLg}]}>›</Text>
            </TouchableOpacity>
          </GlassCard>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.credit, {color: '#FFFFFF', fontSize: f.body}]}>
            {t('welcome.credit', 'Developed by PramIQ')}
          </Text>
          <Text style={[styles.footerText, {color: 'rgba(255,255,255,0.6)', fontSize: f.caption}]}>
            {t('welcome.footer', 'Offline-first • DPDPA-aware • Made in India')}
          </Text>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, paddingHorizontal: SPACING.lg},
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: SPACING.md,
  },
  langPill: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  langText: {fontWeight: '600'},
  brandWrap: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    marginBottom: SPACING.xxl,
  },
  brandBadge: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeText: {
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 1,
  },
  logoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: {width: 150, height: 96},
  credit: {fontWeight: '800', letterSpacing: 0.5, textAlign: 'center', marginBottom: SPACING.xs},
  splashCenter: {alignItems: 'center', justifyContent: 'center'},
  title: {fontWeight: '800', textAlign: 'center'},
  subtitle: {marginTop: SPACING.xs, textAlign: 'center'},
  cardsWrap: {gap: SPACING.lg, marginTop: SPACING.md},
  roleCard: {minHeight: 110},
  roleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  roleEmoji: {fontSize: 44},
  roleTitle: {fontWeight: '700'},
  roleSub: {marginTop: 4},
  arrow: {fontWeight: '300', marginLeft: SPACING.sm},
  footer: {
    position: 'absolute',
    bottom: SPACING.lg,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerText: {textAlign: 'center'},
});
