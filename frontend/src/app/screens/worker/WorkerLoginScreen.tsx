import React, {useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import {
  isValidAadhar,
  normalizeAadhar,
  formatAadharGrouped,
} from '../../utils/aadharValidator';
import {workerLogin} from '../../../sync/adminApi';
import {useSession} from '../../auth/sessionStore';
import {ApiError} from '../../../sync/httpClient';

export default function WorkerLoginScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [name, setName] = useState('');
  const [aadhar, setAadhar] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginAsWorker = useSession(s => s.loginAsWorker);

  const handleLogin = async () => {
    setError(null);
    if (!name.trim() || name.trim().length < 2) {
      setError(t('worker_login.err_name', 'Enter your full name'));
      return;
    }
    if (!isValidAadhar(aadhar)) {
      setError(t('worker_login.err_aadhar', 'Invalid Aadhar number'));
      return;
    }
    setLoading(true);
    try {
      const resp = await workerLogin({
        name: name.trim(),
        aadhar: normalizeAadhar(aadhar),
      });
      await loginAsWorker(resp.access_token, resp.expires_in, resp.worker);
      navigation.reset({index: 0, routes: [{name: 'WorkerHome'}]});
    } catch (e: any) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? t('worker_login.invalid', 'Name or Aadhar does not match. Contact your admin.')
            : e.detail
          : e?.message || t('worker_login.failed', 'Login failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: c.bg}]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{flex: 1}}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, {color: c.textSecondary, fontSize: f.body}]}>
            ‹ {t('common.back')}
          </Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.emoji}>👷</Text>
          <Text style={[styles.title, {color: c.text, fontSize: f.titleLg}]}>
            {t('worker_login.title', 'Worker Login')}
          </Text>
          <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body}]}>
            {t('worker_login.subtitle', 'Enter your name and Aadhar to punch in')}
          </Text>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>
              {t('worker_login.name_label', 'Name')}
            </Text>
            <TextInput
              style={[
                styles.input,
                {backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: f.body},
              ]}
              value={name}
              onChangeText={setName}
              placeholder={t('worker_login.name_ph', 'Your registered name')}
              placeholderTextColor={c.textMuted}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>
              {t('worker_login.aadhar_label', 'Aadhar Number')}
            </Text>
            <TextInput
              style={[
                styles.input,
                {backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: f.body},
              ]}
              value={formatAadharGrouped(aadhar)}
              onChangeText={t => setAadhar(normalizeAadhar(t))}
              placeholder="XXXX XXXX XXXX"
              placeholderTextColor={c.textMuted}
              keyboardType="number-pad"
              maxLength={14}
            />
          </View>

          {error && (
            <Text style={[styles.errorText, {color: c.danger, fontSize: f.body}]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, {backgroundColor: c.primary}, loading && {opacity: 0.6}]}
            onPress={handleLogin}
            disabled={loading}>
            {loading ? (
              <ActivityIndicator color={isAAA ? '#000' : '#FFF'} />
            ) : (
              <Text
                style={[styles.primaryBtnText, {color: isAAA ? '#000' : '#FFF', fontSize: f.action}]}>
                {t('worker_login.btn', 'Login & Continue')}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.hint, {color: c.textMuted, fontSize: f.caption}]}>
            {t('worker_login.hint', 'Need help? Contact your supervisor (admin).')}
          </Text>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  scroll: {flexGrow: 1, paddingBottom: SPACING.xxl},
  backBtn: {padding: SPACING.lg},
  backText: {fontWeight: '600'},
  content: {flex: 1, paddingHorizontal: SPACING.lg, gap: SPACING.lg},
  emoji: {fontSize: 64, textAlign: 'center', marginTop: SPACING.lg},
  title: {fontWeight: '800', textAlign: 'center'},
  subtitle: {textAlign: 'center', marginBottom: SPACING.lg},
  field: {gap: SPACING.xs},
  fieldLabel: {fontWeight: '600'},
  input: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderWidth: 1.5,
  },
  errorText: {color: '#FCA5A5', textAlign: 'center'},
  primaryBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  primaryBtnText: {fontWeight: '800'},
  hint: {textAlign: 'center', marginTop: SPACING.md},
});
