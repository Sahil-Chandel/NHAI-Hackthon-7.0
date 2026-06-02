import React, {useState, useCallback, useRef} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import {
  isValidAadhar,
  normalizeAadhar,
  formatAadharGrouped,
  isValidIndianMobile,
  normalizeMobile,
} from '../../utils/aadharValidator';
import {adminSignup} from '../../../sync/adminApi';
import {useSession} from '../../auth/sessionStore';
import {useFaceEnrollmentBus} from '../../auth/faceEnrollmentBus';
import {useSignupDraft} from '../../auth/signupDraft';
import {ApiError} from '../../../sync/httpClient';

type Step = 'form' | 'face_pending' | 'submitting' | 'done';

export default function AdminSignupScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [aadhar, setAadhar] = useState('');
  const [faceTemplateId, setFaceTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror state so the focus-effect callback (memoised with a stable dep
  // list) can read the LATEST form values when it fires after the user returns
  // from the face-capture screen. Reading state directly would give the stale
  // first-render snapshot.
  const formRef = useRef({name, mobile, aadhar});
  formRef.current = {name, mobile, aadhar};
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  const loginAsAdmin = useSession(s => s.loginAsAdmin);
  const consumeBus = useFaceEnrollmentBus(s => s.consume);
  const setSignupDraft = useSignupDraft(s => s.setDraft);
  const clearSignupDraft = useSignupDraft(s => s.clear);
  const DRAFT_KEY = 'admin_signup' as const;

  const submitSignup = useCallback(
    async (templateId: string) => {
      const draft = useSignupDraft.getState().getDraft(DRAFT_KEY);
      const source = draft ?? formRef.current;
      const n = source.name ?? '';
      const m = source.mobile ?? '';
      const a = source.aadhar ?? '';
      console.log('[AdminSignup] submitSignup called', {templateId, draft: !!draft, name: n, mobile: m, aadhar: a?.slice(0, 4)});
      if (!n.trim() || !isValidIndianMobile(m) || !isValidAadhar(a)) {
        console.log('[AdminSignup] validation failed', {name: !!n.trim(), mobile: isValidIndianMobile(m), aadhar: isValidAadhar(a)});
        setError(t('admin_signup.err_fields', 'Please fill all fields correctly before submitting'));
        setStep('form');
        return;
      }
      try {
        console.log('[AdminSignup] calling adminSignup API...');
        const resp = await adminSignup({
          name: n.trim(),
          mobile: normalizeMobile(m),
          aadhar: normalizeAadhar(a),
          face_template_id: templateId,
        });
        console.log('[AdminSignup] API success, logging in...');
        await loginAsAdmin(resp.access_token, resp.expires_in, resp.admin);
        clearSignupDraft(DRAFT_KEY);
        setStep('done');
        setTimeout(() => {
          navigation.reset({index: 0, routes: [{name: 'AdminMain'}]});
        }, 700);
      } catch (e: any) {
        console.log('[AdminSignup] API error:', e?.message, e?.status, e?.detail);
        const raw =
          e instanceof ApiError
            ? e.detail
            : e?.message || t('admin_signup.err_generic', 'Signup failed');
        const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
        setError(msg);
        setStep('form');
      }
    },
    [loginAsAdmin, navigation, t, clearSignupDraft],
  );

  // When user returns from face enrollment screen, the bus tells us whether
  // capture succeeded, failed structurally (e.g. duplicate face), or whether
  // the user just backed out — show the right thing in each case.
  useFocusEffect(
    useCallback(() => {
      const captured = consumeBus('admin_signup');
      console.log('[AdminSignup] focusEffect fired, captured:', captured?.kind, 'step:', stepRef.current);
      if (captured && captured.kind === 'success') {
        console.log('[AdminSignup] face captured successfully, templateId:', captured.templateId);
        setFaceTemplateId(captured.templateId);
        setStep('submitting');
        submitSignup(captured.templateId).catch(e => console.log('[AdminSignup] submitSignup catch:', e));
        return;
      }
      if (captured && captured.kind === 'error') {
        if (captured.error.code === 'duplicate_face') {
          const role = captured.error.existingRole;
          const name = captured.error.existingName ?? '';
          // The most common case in practice: a worker (already enrolled by
          // an admin) tries to register THEMSELVES as a new admin. Show a
          // pointed message that nudges them to log in via the right flow.
          const msg =
            role === 'worker'
              ? t('admin_signup.dup_as_worker', {
                  name,
                  defaultValue:
                    'You are already registered as a worker. Cannot register again as admin.',
                })
              : role === 'admin'
                ? t('admin_signup.dup_as_admin', {
                    name,
                    defaultValue:
                      'You are already registered as an admin ({{name}}). Use Admin Login instead.',
                  })
                : t('admin_signup.dup_generic', {
                    name,
                    defaultValue: 'This face is already enrolled as {{name}}.',
                  });
          setError(msg);
        } else {
          setError(t('admin_signup.face_cancelled', 'Face capture cancelled — please try again'));
        }
        setStep('form');
        return;
      }
      if (stepRef.current === 'face_pending') {
        // No bus entry AND we were waiting → user backed out of the camera.
        setStep('form');
        setError(t('admin_signup.face_cancelled', 'Face capture cancelled — please try again'));
      }
    }, [consumeBus, submitSignup, t]),
  );

  const validateForm = (): string | null => {
    if (!name.trim() || name.trim().length < 2) return t('admin_signup.err_name', 'Name is required');
    if (!isValidIndianMobile(mobile)) return t('admin_signup.err_mobile', 'Invalid mobile number');
    if (!isValidAadhar(aadhar)) return t('admin_signup.err_aadhar', 'Invalid Aadhar number');
    return null;
  };

  const startFaceCapture = () => {
    const err = validateForm();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // Persist the (normalized) form so it survives a remount while the user is
    // in the camera screen — submitSignup reads this draft back on return.
    setSignupDraft(DRAFT_KEY, {
      name: name.trim(),
      mobile: normalizeMobile(mobile),
      aadhar: normalizeAadhar(aadhar),
    });
    const tempUserId = `admin-${Date.now().toString(36)}`;
    setStep('face_pending');
    navigation.navigate('Enroll', {
      prefilledUserId: tempUserId,
      prefilledName: name.trim(),
      purpose: 'admin_signup',
      returnTo: 'AdminSignup',
    });
  };

  if (step === 'face_pending') {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.message, {color: c.text, fontSize: f.body}]}>
          {t('admin_signup.face_pending', 'Capturing face... follow on-screen prompts')}
        </Text>
      </View>
    );
  }

  if (step === 'submitting') {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.message, {color: c.text, fontSize: f.body}]}>
          {t('admin_signup.submitting', 'Creating your admin account...')}
        </Text>
      </View>
    );
  }

  if (step === 'done') {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <Text style={{fontSize: 72}}>✅</Text>
        <Text style={[styles.message, {color: c.success, fontSize: f.title}]}>
          {t('admin_signup.success', 'Welcome aboard!')}
        </Text>
      </View>
    );
  }

  // Form step
  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: c.bg}]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, {color: c.textSecondary, fontSize: f.body}]}>
            ‹ {t('common.back')}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.title, {color: c.text, fontSize: f.titleLg}]}>
          {t('admin_signup.title', 'Create Admin Account')}
        </Text>
        <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body}]}>
          {t('admin_signup.subtitle', 'Fill your details and register your face')}
        </Text>

        <View style={styles.form}>
          <Field
            label={t('admin_signup.name_label', 'Full Name')}
            value={name}
            onChangeText={setName}
            placeholder={t('admin_signup.name_ph', 'e.g. Ramesh Kumar')}
            c={c}
            f={f}
          />
          <Field
            label={t('admin_signup.mobile_label', 'Mobile Number')}
            value={mobile}
            onChangeText={setMobile}
            placeholder={t('admin_signup.mobile_ph', '10-digit number')}
            keyboardType="phone-pad"
            maxLength={10}
            c={c}
            f={f}
          />
          <Field
            label={t('admin_signup.aadhar_label', 'Aadhar Number')}
            value={formatAadharGrouped(aadhar)}
            onChangeText={txt => setAadhar(normalizeAadhar(txt))}
            placeholder="XXXX XXXX XXXX"
            keyboardType="number-pad"
            maxLength={14}
            c={c}
            f={f}
            helper={t('admin_signup.aadhar_helper', 'Stored hashed — never as plain text')}
          />

          {error && (
            <Text style={[styles.errorText, {fontSize: f.body}]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, {backgroundColor: c.primary}]}
            onPress={startFaceCapture}
            accessibilityRole="button">
            <Text style={[styles.primaryBtnText, {color: isAAA ? '#000' : '#FFF', fontSize: f.action}]}>
              {t('admin_signup.next', 'Continue → Capture Face')}
            </Text>
          </TouchableOpacity>

          {faceTemplateId && (
            <Text style={[styles.faceOk, {color: c.success, fontSize: f.body}]}>
              ✓ {t('admin_signup.face_ok', 'Face registered')}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  c,
  f,
  helper,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  keyboardType?: any;
  maxLength?: number;
  c: any;
  f: any;
  helper?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: f.body},
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
      {helper && (
        <Text style={[styles.helper, {color: c.textMuted, fontSize: f.caption}]}>{helper}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  backBtn: {paddingVertical: SPACING.sm},
  backText: {fontWeight: '600'},
  title: {fontWeight: '800', marginTop: SPACING.md},
  subtitle: {marginTop: SPACING.xs, marginBottom: SPACING.xl},
  form: {gap: SPACING.lg},
  field: {gap: SPACING.xs},
  fieldLabel: {fontWeight: '600'},
  input: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderWidth: 1.5,
  },
  helper: {marginTop: 2},
  errorText: {color: '#FCA5A5', textAlign: 'center'},
  primaryBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  primaryBtnText: {fontWeight: '800', letterSpacing: 0.3},
  faceOk: {textAlign: 'center', fontWeight: '700'},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg},
  message: {textAlign: 'center', marginTop: SPACING.lg},
});
