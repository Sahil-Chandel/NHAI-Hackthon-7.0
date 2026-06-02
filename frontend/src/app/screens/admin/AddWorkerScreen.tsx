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
} from '../../utils/aadharValidator';
import {createWorker} from '../../../sync/adminApi';
import {useFaceEnrollmentBus} from '../../auth/faceEnrollmentBus';
import {useSignupDraft} from '../../auth/signupDraft';
import {ApiError} from '../../../sync/httpClient';

type Step = 'form' | 'face_pending' | 'submitting' | 'done';

export default function AddWorkerScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [aadhar, setAadhar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const consumeBus = useFaceEnrollmentBus(s => s.consume);
  const setSignupDraft = useSignupDraft(s => s.setDraft);
  const clearSignupDraft = useSignupDraft(s => s.clear);
  const DRAFT_KEY = 'add_worker' as const;

  // Refs mirror state so the focus-effect callback can read the latest
  // form values (state captured in useCallback closure would be stale).
  const formRef = useRef({name, aadhar});
  formRef.current = {name, aadhar};
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  const submitWorker = useCallback(
    async (templateId: string) => {
      // Prefer the persisted draft: component state (and formRef) is wiped if
      // this screen remounts on return from the camera. The draft survives.
      const draft = useSignupDraft.getState().getDraft(DRAFT_KEY);
      const {name: n, aadhar: a} = draft ?? formRef.current;
      if (!n.trim() || !isValidAadhar(a)) {
        setError(t('add_worker.err_fields', 'Please fill all fields correctly before submitting'));
        setStep('form');
        return;
      }
      try {
        await createWorker({
          name: n.trim(),
          aadhar: normalizeAadhar(a),
          face_template_id: templateId,
        });
        clearSignupDraft(DRAFT_KEY);
        setStep('done');
        setTimeout(() => navigation.goBack(), 800);
      } catch (e: any) {
        const msg =
          e instanceof ApiError ? e.detail : e?.message || t('add_worker.err_generic', 'Failed');
        setError(msg);
        setStep('form');
      }
    },
    [navigation, t, clearSignupDraft],
  );

  useFocusEffect(
    useCallback(() => {
      const captured = consumeBus('add_worker');
      if (captured && captured.kind === 'success') {
        setStep('submitting');
        submitWorker(captured.templateId).catch(() => {});
        return;
      }
      if (captured && captured.kind === 'error') {
        if (captured.error.code === 'duplicate_face') {
          const role = captured.error.existingRole;
          const name = captured.error.existingName ?? '';
          // Admin tried to add a worker whose face the device already knows.
          // Most often: same worker enrolled twice; could also be the admin's
          // own face being added as a worker by accident.
          const msg =
            role === 'worker'
              ? t('add_worker.dup_as_worker', {
                  name,
                  defaultValue:
                    'A worker is already registered with this face ({{name}}).',
                })
              : role === 'admin'
                ? t('add_worker.dup_as_admin', {
                    name,
                    defaultValue:
                      'This face belongs to an admin ({{name}}). Cannot register as a worker.',
                  })
                : t('add_worker.dup_generic', {
                    name,
                    defaultValue: 'This face is already enrolled as {{name}}.',
                  });
          setError(msg);
        } else {
          setError(t('add_worker.face_cancelled', 'Face capture cancelled — please try again'));
        }
        setStep('form');
        return;
      }
      if (stepRef.current === 'face_pending') {
        setStep('form');
        setError(t('add_worker.face_cancelled', 'Face capture cancelled — please try again'));
      }
    }, [consumeBus, submitWorker, t]),
  );

  const validate = (): string | null => {
    if (!name.trim() || name.trim().length < 2)
      return t('add_worker.err_name', 'Name is required');
    if (!isValidAadhar(aadhar))
      return t('add_worker.err_aadhar', 'Invalid Aadhar number');
    return null;
  };

  const startFaceCapture = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // Persist the (normalized) form so it survives a remount during capture.
    setSignupDraft(DRAFT_KEY, {
      name: name.trim(),
      aadhar: normalizeAadhar(aadhar),
    });
    const tempUserId = `worker-${Date.now().toString(36)}`;
    setStep('face_pending');
    navigation.navigate('Enroll', {
      prefilledUserId: tempUserId,
      prefilledName: name.trim(),
      purpose: 'add_worker',
      returnTo: 'AddWorker',
    });
  };

  if (step === 'face_pending' || step === 'submitting') {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.message, {color: c.text, fontSize: f.body}]}>
          {step === 'face_pending'
            ? t('add_worker.face_pending', 'Capture face...')
            : t('add_worker.submitting', 'Saving worker...')}
        </Text>
      </View>
    );
  }

  if (step === 'done') {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <Text style={{fontSize: 72}}>✅</Text>
        <Text style={[styles.message, {color: c.success, fontSize: f.title}]}>
          {t('add_worker.success', 'Worker added!')}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, {backgroundColor: c.bg}]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={[styles.backText, {color: c.textSecondary, fontSize: f.body}]}>
              ✕
            </Text>
          </TouchableOpacity>
          <Text style={[styles.title, {color: c.text, fontSize: f.title}]}>
            {t('add_worker.title', 'Add Worker')}
          </Text>
          <View style={{width: 30}} />
        </View>

        <Text style={[styles.subtitle, {color: c.textSecondary, fontSize: f.body}]}>
          {t('add_worker.subtitle', 'Enter worker details and capture their face')}
        </Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>
              {t('add_worker.name_label', 'Worker Name')}
            </Text>
            <TextInput
              style={[
                styles.input,
                {backgroundColor: c.surface, color: c.text, borderColor: c.border, fontSize: f.body},
              ]}
              value={name}
              onChangeText={setName}
              placeholder={t('add_worker.name_ph', 'e.g. Suresh Verma')}
              placeholderTextColor={c.textMuted}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, {color: c.text, fontSize: f.body}]}>
              {t('add_worker.aadhar_label', 'Aadhar Number')}
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
            <Text style={[styles.helper, {color: c.textMuted, fontSize: f.caption}]}>
              {t('add_worker.aadhar_helper', 'Stored hashed for privacy')}
            </Text>
          </View>

          {error && <Text style={[styles.errorText, {fontSize: f.body}]}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, {backgroundColor: c.primary}]}
            onPress={startFaceCapture}>
            <Text
              style={[
                styles.primaryBtnText,
                {color: isAAA ? '#000' : '#FFF', fontSize: f.action},
              ]}>
              {t('add_worker.next', 'Continue → Capture Face')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1},
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xxl},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.md,
  },
  backText: {fontSize: 24, width: 30, textAlign: 'left'},
  title: {fontWeight: '800'},
  subtitle: {textAlign: 'center', marginBottom: SPACING.xl},
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
  primaryBtnText: {fontWeight: '800'},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg},
  message: {textAlign: 'center', marginTop: SPACING.lg},
});
