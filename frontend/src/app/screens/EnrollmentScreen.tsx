import React, {useEffect, useCallback, useRef, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {useResizePlugin} from 'vision-camera-resize-plugin';
import {useRunOnJS} from 'react-native-worklets-core';
import {useFaceDetector} from 'react-native-vision-camera-face-detector';
import {useTranslation} from 'react-i18next';
import type {NativeStackNavigationProp, NativeStackScreenProps} from '@react-navigation/native-stack';
import {useRoute, type RouteProp} from '@react-navigation/native';

import {extractMLKitSignature} from '../../ml/processors/mlkitSignature.worklet';
import type {FaceDetection} from '../../ml/processors/faceDetect.worklet';
import {useFaceAuth} from '../hooks/useFaceAuth';
import {useEnrollment} from '../hooks/useEnrollment';
import {useVoicePrompt} from '../components/VoicePrompt';
import {useThemeContext} from '../theme/ThemeContext';
import type {RootStackParamList} from '../navigation/RootStack';
import {
  useFaceEnrollmentBus,
  type EnrollmentPurpose,
} from '../auth/faceEnrollmentBus';

type Props = NativeStackScreenProps<RootStackParamList, 'Enroll'>;

export default function EnrollmentScreen({navigation}: Props) {
  const route = useRoute<RouteProp<RootStackParamList, 'Enroll'>>();
  const params = route.params ?? {};
  const purpose: EnrollmentPurpose = (params.purpose ?? 'standalone') as EnrollmentPurpose;
  const returnTo = params.returnTo;
  const prefilledUserId = params.prefilledUserId;
  const prefilledName = params.prefilledName;
  const handoffDoneRef = useRef(false);
  // Pending back-navigation timer. Stored in a ref (not a per-effect-run local)
  // and cleared ONLY on unmount — see the cleanup effect below. A trailing
  // camera frame can re-render this screen within the handoff window; if the
  // timer lived in the handoff effect's cleanup it would be cancelled on that
  // re-render and — because handoffDoneRef latches true — never rescheduled,
  // stranding the user on the success ("Authentication") view.
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPendingFaceEnrollment = useFaceEnrollmentBus(s => s.setPending);
  const setBusError = useFaceEnrollmentBus(s => s.setError);

  useEffect(() => {
    return () => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const {speak, stop} = useVoicePrompt();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const {detection, fps, hasFace, latestEmbeddingRef, latestSourceRef, onFrameResult} =
    useFaceAuth();

  const enrollment = useEnrollment();

  // Latches green once a face has been aligned at least once, so the
  // "Face detected & aligned" checklist row doesn't flicker when the face
  // momentarily drifts out of the oval between pose captures.
  const [everAligned, setEverAligned] = useState(false);
  useEffect(() => {
    if (hasFace && !everAligned) setEverAligned(true);
  }, [hasFace, everAligned]);
  // A fresh enrollment (or a retry after an error → 'idle') must clear the
  // latch, otherwise the first checklist row shows as already-aligned before a
  // face is seen.
  useEffect(() => {
    if (enrollment.step === 'idle' && everAligned) setEverAligned(false);
  }, [enrollment.step, everAligned]);

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    minFaceSize: 0.2,
  });

  // Real face recognition: EdgeFace 512-d embedding (input float32 [1,112,112,3]).
  // MUST match PunchCaptureScreen's preprocessing exactly so enrolled templates
  // and punch embeddings are comparable.
  const edgeface = useTensorflowModel(
    require('../../../assets/models/edgeface_xs_int8.tflite'),
  );
  const faceModel = edgeface.state === 'loaded' ? edgeface.model : undefined;
  const {resize} = useResizePlugin();

  const onFrameResultJS = useRunOnJS(onFrameResult, [onFrameResult]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const start = performance.now();
      try {
        const faces = faceDetector.detectFaces(frame);
        const latency = performance.now() - start;
        if (faces.length === 0) {
          onFrameResultJS(null, null, latency);
          return;
        }
        const fdet = faces[0];
        const b = fdet.bounds ?? {};
        const det: FaceDetection = {
          x: b.x ?? 0,
          y: b.y ?? 0,
          width: b.width ?? 0,
          height: b.height ?? 0,
          confidence: 1.0,
          landmarks: [],
        };
        let emb: {embedding: number[]; magnitude: number; latencyMs: number; source?: 'edgeface' | 'mlkit_fallback'} | null = null;
        const bw = b.width ?? 0;
        const bh = b.height ?? 0;
        if (faceModel && bw > 20 && bh > 20) {
          try {
            const fw = frame.width;
            const fh = frame.height;
            const mx = bw * 0.1;
            const my = bh * 0.1;
            let cx = (b.x ?? 0) - mx;
            if (cx < 0) cx = 0;
            let cy = (b.y ?? 0) - my;
            if (cy < 0) cy = 0;
            let cw = bw + 2 * mx;
            if (cx + cw > fw) cw = fw - cx;
            let ch = bh + 2 * my;
            if (cy + ch > fh) ch = fh - cy;
            const resized = resize(frame, {
              crop: {
                x: Math.round(cx),
                y: Math.round(cy),
                width: Math.round(cw),
                height: Math.round(ch),
              },
              scale: {width: 112, height: 112},
              pixelFormat: 'rgb',
              dataType: 'float32',
            });
            // resize plugin float32 output is already [0,1] (NOT [0,255]) — see
            // vision-camera-resize-plugin docs. Map [0,1] → [-1,1] for EdgeFace.
            // MUST stay identical to PunchCaptureScreen's normalization or the
            // enrolled template and the punch probe won't be comparable. (The old
            // `/127.5 - 1.0` assumed [0,255] and squashed every pixel to ~-1.0,
            // making all faces produce near-identical embeddings.)
            for (let i = 0; i < resized.length; i++) {
              resized[i] = resized[i] * 2.0 - 1.0;
            }
            const outputs = faceModel.runSync([resized]);
            const raw = outputs && outputs[0];
            const len = raw ? raw.length ?? 0 : 0;
            if (len >= 128) {
              const L = len < 512 ? len : 512;
              let ss = 0;
              for (let i = 0; i < L; i++) ss += (raw[i] as number) * (raw[i] as number);
              const mag = Math.sqrt(ss);
              if (mag > 1e-6) {
                const e = new Array(512);
                for (let i = 0; i < 512; i++) e[i] = i < L ? (raw[i] as number) / mag : 0;
                emb = {embedding: e, magnitude: mag, latencyMs: 0, source: 'edgeface'};
              }
            }
          } catch (_e) {}
        }
        if (!emb) emb = extractMLKitSignature(fdet, frame.width, frame.height);
        onFrameResultJS(det, emb, latency);
      } catch {}
    },
    [faceDetector, onFrameResultJS, faceModel, resize],
  );

  useEffect(() => {
    if (enrollment.step !== 'idle' && enrollment.step !== 'processing' && enrollment.step !== 'done' && enrollment.step !== 'error') {
      const label = t(enrollment.stepLabel);
      speak(label);
    }
  }, [enrollment.step, enrollment.stepLabel, speak, t]);

  useEffect(() => {
    if (enrollment.step === 'done') {
      speak(t('enroll.success'), true);
    } else if (enrollment.step === 'error') {
      speak(t('enroll.fail'), true);
    }
  }, [enrollment.step, speak, t]);

  // Auto-start when invoked with prefilled identity (admin signup / add worker)
  useEffect(() => {
    if (
      enrollment.step === 'idle' &&
      !handoffDoneRef.current &&
      prefilledUserId &&
      prefilledName &&
      purpose !== 'standalone'
    ) {
      enrollment.setUserId(prefilledUserId);
      enrollment.setName(prefilledName);
      // Worker onboarding skips the cross-identity duplicate check (identity is
      // already proven by the registry match + JWT); avoids false-positive
      // lockouts between similar faces on a shared device.
      enrollment.startEnrollment(prefilledUserId, prefilledName, purpose === 'worker_onboard');
    }
  }, [enrollment, prefilledUserId, prefilledName, purpose]);

  // Hand off result to bus + navigate back when called by another screen.
  // Handles BOTH success and error so the originating screen can react
  // (a duplicate face captured during admin signup, for example, gets routed
  // back as a structured bus error so AdminSignup can show a role-aware
  // message instead of leaving the user stuck on a generic error view).
  useEffect(() => {
    if (purpose === 'standalone' || !returnTo || handoffDoneRef.current) {
      return;
    }

    if (enrollment.step === 'done' && enrollment.enrolledId) {
      handoffDoneRef.current = true;
      setPendingFaceEnrollment(
        purpose,
        enrollment.enrolledId,
        prefilledUserId || enrollment.userId,
        prefilledName || enrollment.name,
        enrollment.metrics ?? undefined,
      );
      navTimerRef.current = setTimeout(() => {
        enrollment.reset();
        navigation.navigate(returnTo as any);
      }, 800);
      // No per-run cleanup: handoffDoneRef guards against double-scheduling and
      // the unmount effect clears the timer, so a re-render can't cancel it.
      return;
    }

    if (enrollment.step === 'error') {
      handoffDoneRef.current = true;
      if (enrollment.duplicate) {
        setBusError({
          purpose,
          code: 'duplicate_face',
          existingRole: enrollment.duplicate.existingRole,
          existingName: enrollment.duplicate.existingName,
          message: enrollment.error ?? undefined,
        });
      } else {
        setBusError({
          purpose,
          code: 'capture_failed',
          message: enrollment.error ?? undefined,
        });
      }
      navTimerRef.current = setTimeout(() => {
        enrollment.reset();
        navigation.navigate(returnTo as any);
      }, 1200);
      // See the success branch above — timer is cleared only on unmount.
      return;
    }
  }, [
    enrollment.step,
    enrollment.enrolledId,
    enrollment.error,
    enrollment.duplicate,
    purpose,
    returnTo,
    setPendingFaceEnrollment,
    setBusError,
    prefilledUserId,
    prefilledName,
    enrollment,
    navigation,
  ]);

  const handleCapture = useCallback(() => {
    if (!latestEmbeddingRef.current) {
      Alert.alert(t('enroll.no_face'));
      return;
    }
    // Never persist a template built from the ML-Kit fallback signature: it is
    // non-discriminative and would match everyone, breaking punch verification.
    // Refuse the capture until the real EdgeFace engine is producing embeddings.
    if (latestSourceRef.current !== 'edgeface') {
      Alert.alert(
        t('common.error'),
        t('enroll.engine_unavailable', 'Face engine not ready. Please update the app and try again.'),
      );
      return;
    }
    enrollment.captureEmbedding([...latestEmbeddingRef.current]);
  }, [enrollment, latestEmbeddingRef, latestSourceRef, t]);

  const handleStart = useCallback(() => {
    if (!enrollment.userId.trim() || !enrollment.name.trim()) {
      Alert.alert(t('common.error'), t('enroll.error_fields'));
      return;
    }
    enrollment.startEnrollment(enrollment.userId.trim(), enrollment.name.trim());
  }, [enrollment]);

  if (!hasPermission) {
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <Text style={[styles.message, isAAA && styles.textAAA]}>{t('common.camera_required')}</Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={() => requestPermission().then(granted => {
            if (!granted) Linking.openSettings();
          })}>
          <Text style={styles.permissionBtnText}>{t('common.grant_permission')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <Text style={[styles.message, isAAA && styles.textAAA]}>{t('common.no_camera')}</Text>
      </View>
    );
  }

  // Auto-start flows (worker onboarding / admin) flip step to 'frontal' in an
  // effect right after mount; render a loader instead of flashing the manual
  // ID/Name form for one frame.
  if (enrollment.step === 'idle' && purpose !== 'standalone') {
    const loaderPal = isAAA ? AUTH_AAA : AUTH_LIGHT;
    return (
      <View style={[styles.container, {backgroundColor: loaderPal.bg}]}>
        <View style={styles.form}>
          <ActivityIndicator size="large" color={loaderPal.btn} />
        </View>
      </View>
    );
  }

  // Input form (standalone manual enrollment)
  if (enrollment.step === 'idle') {
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <View style={styles.form}>
          <Text style={[styles.title, isAAA && styles.titleAAA]}>{t('enroll.title')}</Text>
          <TextInput
            style={[styles.input, isAAA && styles.inputAAA]}
            placeholder={t('enroll.enter_id')}
            placeholderTextColor={isAAA ? '#999900' : '#666'}
            value={enrollment.userId}
            onChangeText={enrollment.setUserId}
          />
          <TextInput
            style={[styles.input, isAAA && styles.inputAAA]}
            placeholder={t('enroll.enter_name')}
            placeholderTextColor={isAAA ? '#999900' : '#666'}
            value={enrollment.name}
            onChangeText={enrollment.setName}
          />
          <TouchableOpacity style={[styles.startBtn, isAAA && styles.startBtnAAA]} onPress={handleStart}>
            <Text style={[styles.startBtnText, isAAA && styles.startBtnTextAAA]}>{t('enroll.start')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}>
            <Text style={[styles.backBtnText, isAAA && styles.textAAA]}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Authentication layout (mockup-styled) ----
  // Reached for every active step: frontal | left | right | processing | done | error.
  // Header → camera card (LIVE badge + oval) → 4-step checklist → button.
  const step = enrollment.step;
  const isCapture = step === 'frontal' || step === 'left' || step === 'right';
  const isProcessing = step === 'processing';
  const isDone = step === 'done';
  const isError = step === 'error';
  // Poses already captured (0..3). After the 3rd capture the step flips to
  // 'processing', so processing/done/error all imply all 3 captured.
  const captured = isCapture ? enrollment.stepIndex : enrollment.totalSteps;

  type RowState = 'done' | 'active' | 'pending' | 'error';
  // Map the real 3-pose enrollment progress onto the mockup's 4-step checklist:
  //   1 aligned  -> a face has been seen in the oval
  //   2 liveness -> the frontal pose was captured (proves a live face)
  //   3 challenge-> the left/right pose turns ("active challenge")
  //   4 recognition -> embeddings processed into a template
  const s1: RowState = everAligned ? 'done' : 'active';
  const s2: RowState = captured >= 1 ? 'done' : everAligned ? 'active' : 'pending';
  const s3: RowState = captured >= 3 ? 'done' : captured >= 1 ? 'active' : 'pending';
  const s4: RowState = isDone ? 'done' : isError ? 'error' : isProcessing ? 'active' : 'pending';

  const poseHint = isCapture ? t(enrollment.stepLabel) : '';
  const rows: {n: number; label: string; state: RowState; hint: string}[] = [
    {n: 1, label: t('enroll.auth.step1'), state: s1, hint: ''},
    {n: 2, label: t('enroll.auth.step2'), state: s2, hint: step === 'frontal' ? poseHint : ''},
    {n: 3, label: t('enroll.auth.step3'), state: s3, hint: step === 'left' || step === 'right' ? poseHint : ''},
    {n: 4, label: t('enroll.auth.step4'), state: s4, hint: ''},
  ];

  const pal = isAAA ? AUTH_AAA : AUTH_LIGHT;

  // Bottom button — keeps the manual per-pose Capture interaction.
  let btnLabel: string;
  let btnEnabled: boolean;
  let btnOnPress: (() => void) | undefined;
  let btnTone: 'primary' | 'success' | 'disabled' | 'danger';
  if (isCapture) {
    btnEnabled = hasFace;
    btnLabel = hasFace
      ? `${t('enroll.capture_btn')} (${captured + 1}/${enrollment.totalSteps})`
      : t('enroll.no_face');
    btnOnPress = handleCapture;
    btnTone = hasFace ? 'primary' : 'disabled';
  } else if (isProcessing) {
    btnEnabled = false;
    btnLabel = t('enroll.auth.recognizing');
    btnTone = 'disabled';
  } else if (isDone) {
    btnEnabled = true;
    btnLabel = t('enroll.auth.done_btn');
    btnTone = 'success';
    // Standalone dismisses itself. Worker/admin flows normally auto-navigate via
    // the handoff timer, but the button is ALSO wired as a manual fallback so it
    // is NEVER dead: tapping "Done" completes the handoff immediately (the bus
    // pending was already set when step became 'done') instead of waiting on —
    // or silently depending on — the timer.
    btnOnPress =
      purpose === 'standalone'
        ? () => {
            enrollment.reset();
            navigation.goBack();
          }
        : returnTo
        ? () => {
            if (navTimerRef.current) {
              clearTimeout(navTimerRef.current);
              navTimerRef.current = null;
            }
            enrollment.reset();
            navigation.navigate(returnTo as any);
          }
        : undefined;
  } else {
    btnEnabled = true;
    btnLabel = t('common.back');
    btnTone = 'danger';
    btnOnPress = () => {
      enrollment.reset();
      navigation.goBack();
    };
  }

  const caption = isError
    ? enrollment.error ?? t('enroll.fail')
    : isDone
    ? t('enroll.auth.ready')
    : t('enroll.auth.hint');

  return (
    <View style={[styles.authScreen, {backgroundColor: pal.bg}]}>
      <StatusBar
        barStyle={isAAA ? 'light-content' : 'dark-content'}
        backgroundColor={pal.bg}
      />
      <ScrollView
        contentContainerStyle={styles.authContent}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.authTitle, {color: pal.text}]}>
          {t('enroll.auth.title')}
        </Text>

        {/* Camera card */}
        <View
          style={[
            styles.authCard,
            {
              borderColor: pal.cardBorder,
              borderWidth: pal.cardBorder === 'transparent' ? 0 : 2,
            },
          ]}>
          {isCapture && device ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={true}
              frameProcessor={frameProcessor}
              pixelFormat="yuv"
            />
          ) : null}

          {isCapture && (
            <>
              <View style={[styles.liveBadge, {backgroundColor: pal.liveBg}]}>
                <View style={[styles.liveDot, {backgroundColor: pal.live}]} />
                <Text style={[styles.liveText, {color: pal.live}]}>
                  {t('enroll.auth.live')}
                </Text>
              </View>
              <View style={styles.cardCenter} pointerEvents="none">
                <View
                  style={[
                    styles.authOval,
                    {borderColor: hasFace ? pal.ovalOk : pal.oval},
                  ]}
                />
              </View>
            </>
          )}

          {isProcessing && (
            <View style={styles.cardCenter}>
              <ActivityIndicator size="large" color={pal.live} />
            </View>
          )}
          {isDone && (
            <View style={styles.cardCenter}>
              <View style={[styles.bigBadge, {backgroundColor: pal.done}]}>
                <Text style={styles.bigBadgeGlyph}>✓</Text>
              </View>
            </View>
          )}
          {isError && (
            <View style={styles.cardCenter}>
              <View style={[styles.bigBadge, {backgroundColor: pal.danger}]}>
                <Text style={styles.bigBadgeGlyph}>✕</Text>
              </View>
            </View>
          )}
        </View>

        {/* Steps checklist */}
        <Text style={[styles.stepsLabel, {color: pal.sub}]}>
          {t('enroll.auth.steps')}
        </Text>
        <View>
          {rows.map((r, i) => {
            const circleStyle =
              r.state === 'done' || r.state === 'active'
                ? {
                    backgroundColor: r.state === 'done' ? pal.done : pal.active,
                    borderColor: r.state === 'done' ? pal.done : pal.active,
                  }
                : r.state === 'error'
                ? {backgroundColor: 'transparent', borderColor: pal.danger}
                : {backgroundColor: pal.pendingBg, borderColor: pal.pendingBorder};
            const labelColor =
              r.state === 'active'
                ? pal.active
                : r.state === 'error'
                ? pal.danger
                : pal.text;
            return (
              <View key={r.n} style={styles.stepRow}>
                <View style={styles.stepIndicator}>
                  {i < rows.length - 1 && (
                    <View style={[styles.stepLine, {backgroundColor: pal.line}]} />
                  )}
                  {r.state === 'active' && (
                    <View
                      style={[styles.stepHalo, {backgroundColor: pal.activeHalo}]}
                    />
                  )}
                  <View style={[styles.stepCircle, circleStyle]}>
                    {r.state === 'done' ? (
                      <Text style={styles.stepCheck}>✓</Text>
                    ) : r.state === 'error' ? (
                      <Text style={[styles.stepNum, {color: pal.danger}]}>!</Text>
                    ) : (
                      <Text
                        style={[
                          styles.stepNum,
                          {color: r.state === 'active' ? pal.activeNum : pal.pendingText},
                        ]}>
                        {r.n}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.stepTextWrap}>
                  <Text style={[styles.stepLabel, {color: labelColor}]}>
                    {r.label}
                  </Text>
                  {!!r.hint && (
                    <Text style={[styles.stepHint, {color: pal.sub}]}>{r.hint}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.authBottom}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!btnEnabled}
            onPress={btnOnPress}
            style={[
              styles.authBtn,
              {
                backgroundColor:
                  btnTone === 'primary'
                    ? pal.btn
                    : btnTone === 'success'
                    ? pal.done
                    : btnTone === 'danger'
                    ? pal.danger
                    : pal.btnDisabled,
              },
            ]}>
            {isProcessing && (
              <ActivityIndicator
                size="small"
                color={pal.btnDisabledText}
                style={{marginRight: 8}}
              />
            )}
            <Text
              style={[
                styles.authBtnText,
                {color: btnTone === 'disabled' ? pal.btnDisabledText : pal.btnText},
              ]}
              numberOfLines={1}>
              {btnLabel}
            </Text>
          </TouchableOpacity>
          <Text
            style={[styles.authCaption, {color: isError ? pal.danger : pal.sub}]}>
            {caption}
          </Text>
          {__DEV__ && (
            <Text style={[styles.authDebug, {color: pal.sub}]}>
              {fps > 0 ? `${fps} FPS` : ''}
              {detection ? ` | ${detection.confidence.toFixed(2)}` : ''}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Camera card height scales to the screen so the title + card + 4-step
// checklist + button all fit on small devices (the ScrollView still scrolls
// as a fallback if content ever exceeds the viewport).
const CARD_H = Math.max(
  240,
  Math.min(340, Math.round(Dimensions.get('window').height * 0.4)),
);

// Palette for the mockup-styled Authentication screen. Light = pixel-match the
// reference; AAA = high-contrast variant so outdoor/accessibility mode stays
// usable instead of flashing a white screen.
const AUTH_LIGHT = {
  bg: '#FFFFFF',
  text: '#111114',
  sub: '#8A8A8E',
  cardBorder: 'transparent',
  live: '#34D399',
  liveBg: '#14532D',
  oval: 'rgba(255,255,255,0.92)',
  ovalOk: '#22C55E',
  done: '#1F9D3D',
  active: '#2563EB',
  activeNum: '#FFFFFF',
  activeHalo: 'rgba(37,99,235,0.18)',
  pendingBg: '#FFFFFF',
  pendingBorder: '#AEB4C0', // visible on white (the lighter #CBD0D8 vanished)
  pendingText: '#868C99',
  line: '#E5E7EB',
  btn: '#2563EB',
  btnText: '#FFFFFF',
  btnDisabled: '#CBD0D8',
  btnDisabledText: '#4B5563', // readable on the gray disabled/processing button
  danger: '#DC2626',
};
const AUTH_AAA: typeof AUTH_LIGHT = {
  bg: '#000000',
  text: '#FFFFFF',
  sub: '#FFD700',
  cardBorder: '#FFD700',
  live: '#00FF66',
  liveBg: '#003318',
  oval: '#FFD700',
  ovalOk: '#00FF66',
  done: '#00B548',
  active: '#FFD700',
  activeNum: '#000000',
  activeHalo: 'rgba(255,215,0,0.25)',
  pendingBg: '#000000',
  pendingBorder: '#FFA500',
  pendingText: '#FFA500',
  line: '#665500',
  btn: '#FFD700',
  btnText: '#000000',
  btnDisabled: '#333300',
  btnDisabledText: '#FFA500',
  danger: '#FF3333',
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0F172A'},
  containerAAA: {backgroundColor: '#000'},
  message: {
    color: '#F8FAFC',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  textAAA: {color: '#FFD700', fontSize: 18},
  permissionBtn: {
    marginTop: 24,
    alignSelf: 'center',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  form: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  titleAAA: {color: '#FFD700', fontSize: 34},
  input: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: '#334155',
  },
  inputAAA: {
    borderWidth: 2,
    borderColor: '#FFD700',
    backgroundColor: '#1a1a00',
    color: '#FFD700',
    fontSize: 18,
  },
  startBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#3B82F6',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  startBtnAAA: {backgroundColor: '#FFD700', paddingVertical: 22, borderRadius: 18},
  startBtnText: {color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5},
  startBtnTextAAA: {color: '#000', fontSize: 24},
  backBtn: {paddingVertical: 12, alignItems: 'center'},
  backBtnText: {color: '#94A3B8', fontSize: 14, fontWeight: '600'},

  // ---- Mockup-styled Authentication screen ----
  authScreen: {flex: 1},
  authContent: {
    flexGrow: 1,
    paddingTop: 54,
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  authTitle: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: 0.3,
  },
  authCard: {
    height: CARD_H,
    borderRadius: 24,
    backgroundColor: '#000',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
    zIndex: 5,
  },
  liveDot: {width: 7, height: 7, borderRadius: 4},
  liveText: {fontSize: 13, fontWeight: '800', letterSpacing: 1},
  authOval: {
    width: 152,
    height: 204,
    borderRadius: 102,
    borderWidth: 3,
  },
  bigBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBadgeGlyph: {color: '#fff', fontSize: 44, fontWeight: '800'},
  stepsLabel: {
    marginTop: 22,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  stepRow: {flexDirection: 'row', alignItems: 'stretch'},
  stepIndicator: {width: 40, alignItems: 'center'},
  stepLine: {
    position: 'absolute',
    top: 30,
    bottom: 0,
    left: 19, // centre of the 40-wide column (keeps the 2px line under circles)
    width: 2,
    zIndex: 0,
  },
  stepHalo: {
    position: 'absolute',
    top: -3,
    left: -2, // centre the 44-wide halo over the 34-wide circle
    width: 44,
    height: 44,
    borderRadius: 22,
    zIndex: 1,
  },
  stepCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  stepNum: {fontSize: 15, fontWeight: '700'},
  stepCheck: {color: '#fff', fontSize: 17, fontWeight: '800'},
  stepTextWrap: {flex: 1, marginLeft: 12, paddingTop: 5, paddingBottom: 16},
  stepLabel: {fontSize: 18, fontWeight: '600'},
  stepHint: {fontSize: 13, marginTop: 3, fontWeight: '500'},
  authBottom: {marginTop: 'auto', paddingTop: 18},
  authBtn: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBtnText: {fontSize: 18, fontWeight: '800', letterSpacing: 0.3},
  authCaption: {textAlign: 'center', fontSize: 13, marginTop: 10, fontWeight: '500'},
  authDebug: {textAlign: 'center', fontSize: 11, marginTop: 8},
});
