import React, {useCallback, useEffect, useRef, useState} from 'react';
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
  BackHandler,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import {workerVerify, registerWorkerFace} from '../../../sync/adminApi';
import type {WorkerTokenResponse} from '../../../sync/adminApi';
import {useSession} from '../../auth/sessionStore';
import {ApiError} from '../../../sync/httpClient';
import {useFaceEnrollmentBus} from '../../auth/faceEnrollmentBus';
import {getTemplatesByUser} from '../../../storage/db/templates.repo';

type Step = 'form' | 'verified' | 'registering';

// Onboarding token + profile, held outside React state so the focus effect
// always sees the latest value regardless of render timing.
type Onboard = {token: string; expiresIn: number; worker: WorkerTokenResponse['worker']};

// MODULE-LEVEL so it survives a remount of WorkerOnboardScreen. React Navigation
// can recreate this screen when returning from the Enroll camera screen; a
// component ref would be lost (the form would reappear and the face handoff
// would silently drop). Keeping the context here lets a freshly-mounted screen
// resume the flow. Cleared once onboarding completes.
let onboardCtx: Onboard | null = null;

export default function WorkerOnboardScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');

  // Resume at the verified step if we still hold an onboarding context (e.g.
  // this screen was remounted on the way back from the camera).
  const [step, setStep] = useState<Step>(() => (onboardCtx ? 'verified' : 'form'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginAsWorker = useSession(s => s.loginAsWorker);
  const consumeFace = useFaceEnrollmentBus(s => s.consume);

  // Re-entrancy guard so the focus effect doesn't double-register a face.
  const processingRef = useRef(false);

  // While the face is being saved + session committed, block hardware back so
  // the user can't abandon mid-commit and get yanked to WorkerHome after.
  useEffect(() => {
    if (step !== 'registering') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [step]);

  // ---- Step 1: verify identity against Datalake 3.0 ----
  const handleVerify = useCallback(async () => {
    setError(null);
    if (!firstName.trim()) {
      setError(t('worker_onboard.err_first', 'Enter your first name'));
      return;
    }
    if (!lastName.trim()) {
      setError(t('worker_onboard.err_last', 'Enter your last name'));
      return;
    }
    if (mobile.replace(/\D/g, '').length !== 10) {
      setError(t('worker_onboard.err_mobile', 'Enter a valid 10-digit mobile number'));
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t('worker_onboard.err_email', 'Enter a valid email address'));
      return;
    }
    setLoading(true);
    try {
      const resp = await workerVerify({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        mobile: mobile.replace(/\D/g, ''),
        email: email.trim(),
      });
      onboardCtx = {
        token: resp.access_token,
        expiresIn: resp.expires_in,
        worker: resp.worker,
      };
      setStep('verified');
    } catch (e: any) {
      const msg =
        e instanceof ApiError
          ? e.status === 404
            ? t('worker_onboard.not_found', 'Your details did not match the worker registry. Please check and try again.')
            : e.detail
          : e?.message || t('worker_onboard.failed', 'Verification failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, mobile, email, t]);

  // ---- Step 2: launch the one-time face registration (reuses Enrollment) ----
  const handleRegisterFace = useCallback(() => {
    const ob = onboardCtx;
    if (!ob) return;
    setError(null);
    navigation.navigate('Enroll', {
      purpose: 'worker_onboard',
      returnTo: 'WorkerOnboard',
      prefilledUserId: `worker-${ob.worker.id}`,
      prefilledName: ob.worker.name,
    });
  }, [navigation]);

  // ---- Step 3: on return from Enrollment, persist the face + session ----
  const finishOnboarding = useCallback(
    async (templateId: string, userId: string) => {
      const ob = onboardCtx;
      if (!ob || processingRef.current) return;
      processingRef.current = true;
      setStep('registering');
      setError(null);
      try {
        const templates = getTemplatesByUser(userId);
        const tmpl =
          templates.find(x => x.id === templateId) ??
          templates[templates.length - 1];
        if (!tmpl || !tmpl.embedding?.length) {
          throw new Error(
            t('worker_onboard.no_template', 'Could not read the captured face. Please retry.'),
          );
        }
        try {
          await registerWorkerFace(
            {face_template_id: templateId, embedding: tmpl.embedding},
            ob.token,
          );
        } catch (e: any) {
          // 409 = this worker's face is already registered centrally (e.g.
          // re-onboarding on a new device). The fresh on-device template we
          // just enrolled is what punch verification uses, so it's safe to
          // continue — the central Datalake copy is intentionally written once.
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
        // Face is saved on-device (and in the Datalake on first registration).
        // Only NOW do we commit the session — a half-onboarded worker can
        // never reach Punch.
        await loginAsWorker(ob.token, ob.expiresIn, ob.worker);
        onboardCtx = null; // onboarding complete — clear the resume context
        navigation.reset({index: 0, routes: [{name: 'WorkerHome'}]});
      } catch (e: any) {
        const msg =
          e instanceof ApiError
            ? e.detail
            : e?.message || t('worker_onboard.reg_failed', 'Could not save your face. Please try again.');
        setError(msg);
        setStep('verified');
      } finally {
        processingRef.current = false;
      }
    },
    [loginAsWorker, navigation, t],
  );

  // Consume the enrollment result when we come back from the camera screen.
  useFocusEffect(
    useCallback(() => {
      if (!onboardCtx) return;
      const result = consumeFace('worker_onboard');
      if (!result) return;
      if (result.kind === 'success') {
        finishOnboarding(result.templateId, result.userId);
      } else {
        const msg =
          result.error.code === 'duplicate_face'
            ? t('worker_onboard.dup_face', 'This face is already registered for another worker.')
            : t('worker_onboard.capture_failed', 'Face capture failed. Please try again.');
        setError(msg);
        setStep('verified');
      }
    }, [consumeFace, finishOnboarding, t]),
  );

  const renderInput = (
    label: string,
    value: string,
    onChange: (s: string) => void,
    opts: {
      placeholder: string;
      keyboardType?: 'default' | 'number-pad' | 'email-address';
      autoCapitalize?: 'none' | 'words';
      maxLength?: number;
    },
  ) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: f.body},
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={opts.placeholder}
        placeholderTextColor={c.textMuted}
        keyboardType={opts.keyboardType ?? 'default'}
        autoCapitalize={opts.autoCapitalize ?? 'none'}
        autoCorrect={false}
        maxLength={opts.maxLength}
        editable={step === 'form'}
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: c.bg}]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{flex: 1}}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            disabled={step === 'registering'}>
            <Text
              style={[
                styles.backText,
                {color: c.textSecondary, fontSize: f.body},
                step === 'registering' && {opacity: 0.3},
              ]}>
              ‹ {t('common.back')}
            </Text>
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={styles.emoji}>👷</Text>
            <Text
              style={[styles.title, {color: c.text, fontSize: f.titleLg}]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {t('worker_onboard.title', 'Worker Login')}
            </Text>
            <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body}]}>
              {t('worker_onboard.subtitle', 'Enter your details to verify against the worker registry')}
            </Text>

            {step === 'form' && (
              <>
                {renderInput(
                  t('worker_onboard.first_label', 'First Name'),
                  firstName,
                  setFirstName,
                  {placeholder: t('worker_onboard.first_ph', 'e.g. Rajesh'), autoCapitalize: 'words'},
                )}
                {renderInput(
                  t('worker_onboard.last_label', 'Last Name'),
                  lastName,
                  setLastName,
                  {placeholder: t('worker_onboard.last_ph', 'e.g. Kumar'), autoCapitalize: 'words'},
                )}
                {renderInput(
                  t('worker_onboard.mobile_label', 'Mobile Number'),
                  mobile,
                  s => setMobile(s.replace(/\D/g, '')),
                  {placeholder: t('worker_onboard.mobile_ph', '10-digit number'), keyboardType: 'number-pad', maxLength: 10},
                )}
                {renderInput(
                  t('worker_onboard.email_label', 'Email'),
                  email,
                  setEmail,
                  {placeholder: t('worker_onboard.email_ph', 'you@example.com'), keyboardType: 'email-address'},
                )}

                {error && (
                  <Text style={[styles.errorText, {color: c.danger, fontSize: f.body}]}>{error}</Text>
                )}

                <TouchableOpacity
                  style={[styles.primaryBtn, {backgroundColor: c.primary}, loading && {opacity: 0.6}]}
                  onPress={handleVerify}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color={isAAA ? '#000' : '#FFF'} />
                  ) : (
                    <Text
                      style={[styles.primaryBtnText, {color: isAAA ? '#000' : '#FFF', fontSize: f.action}]}>
                      {t('worker_onboard.btn', 'Login & Continue')}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {step === 'verified' && (
              <View style={styles.verifiedWrap}>
                <View style={[styles.verifiedBadge, {backgroundColor: c.success}]}>
                  <Text style={[styles.verifiedCheck, {color: isAAA ? '#000' : '#FFF'}]}>✓</Text>
                </View>
                <Text style={[styles.verifiedTitle, {color: c.success, fontSize: f.title}]}>
                  {t('worker_onboard.verified', 'User Verified')}
                </Text>
                <Text
                  style={[styles.verifiedName, {color: c.text, fontSize: f.titleLg}]}
                  numberOfLines={1}
                  adjustsFontSizeToFit>
                  {onboardCtx?.worker.name}
                </Text>
                <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body}]}>
                  {t('worker_onboard.register_hint', 'One-time step: register your face so you can punch in/out.')}
                </Text>

                {error && (
                  <Text style={[styles.errorText, {color: c.danger, fontSize: f.body}]}>{error}</Text>
                )}

                <TouchableOpacity
                  style={[styles.primaryBtn, {backgroundColor: c.primary}]}
                  onPress={handleRegisterFace}>
                  <Text
                    style={[styles.primaryBtnText, {color: isAAA ? '#000' : '#FFF', fontSize: f.action}]}>
                    {t('worker_onboard.register_btn', 'Register Your Face')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'registering' && (
              <View style={styles.verifiedWrap}>
                <ActivityIndicator color={c.primary} size="large" />
                <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body, marginTop: SPACING.md}]}>
                  {t('worker_onboard.saving', 'Saving your face securely...')}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  scroll: {flexGrow: 1, paddingBottom: SPACING.xxl},
  backBtn: {padding: SPACING.lg, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'},
  backText: {fontWeight: '600'},
  content: {flex: 1, paddingHorizontal: SPACING.lg, gap: SPACING.lg},
  emoji: {fontSize: 64, textAlign: 'center', marginTop: SPACING.sm},
  title: {fontWeight: '800', textAlign: 'center'},
  subtitle: {textAlign: 'center', marginBottom: SPACING.sm},
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
  verifiedWrap: {alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg},
  verifiedBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedCheck: {color: '#FFF', fontSize: 40, fontWeight: '900'},
  verifiedTitle: {fontWeight: '800', marginTop: SPACING.sm},
  verifiedName: {fontWeight: '900'},
});
