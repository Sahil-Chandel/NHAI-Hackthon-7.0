import React, {useEffect, useCallback, useRef} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useTensorflowModel} from 'react-native-fast-tflite';
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
import EnrollmentProgress from '../components/EnrollmentProgress';
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
  const setPendingFaceEnrollment = useFaceEnrollmentBus(s => s.setPending);
  const setBusError = useFaceEnrollmentBus(s => s.setError);
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

  const {detection, fps, hasFace, latestEmbeddingRef, onFrameResult} = useFaceAuth();

  const enrollment = useEnrollment();

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    minFaceSize: 0.2,
  });

  const onFrameResultJS = useRunOnJS(onFrameResult, [onFrameResult]);

  // ML Kit face detector → derive 512-d identity signature from landmarks+pose.
  // (EdgeFace TFLite fails silently on this device; this fallback is robust.)
  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const start = performance.now();
      try {
        const faces = faceDetector.detectFaces(frame);
        const latency = performance.now() - start;
        if (faces.length > 0) {
          const f = faces[0];
          const det: FaceDetection = {
            x: f.bounds?.x ?? 0,
            y: f.bounds?.y ?? 0,
            width: f.bounds?.width ?? 0,
            height: f.bounds?.height ?? 0,
            confidence: 1.0,
            landmarks: [],
          };
          const sig = extractMLKitSignature(f, frame.width, frame.height);
          onFrameResultJS(det, sig, latency);
        } else {
          onFrameResultJS(null, null, latency);
        }
      } catch {}
    },
    [faceDetector, onFrameResultJS],
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
      );
      const timer = setTimeout(() => {
        enrollment.reset();
        navigation.navigate(returnTo as any);
      }, 800);
      return () => clearTimeout(timer);
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
      const timer = setTimeout(() => {
        enrollment.reset();
        navigation.navigate(returnTo as any);
      }, 1200);
      return () => clearTimeout(timer);
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
    enrollment.captureEmbedding([...latestEmbeddingRef.current]);
  }, [enrollment, latestEmbeddingRef, t]);

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
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <View style={styles.form}>
          <ActivityIndicator size="large" color={isAAA ? '#ffdd00' : '#0096ff'} />
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

  // Processing
  if (enrollment.step === 'processing') {
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <View style={styles.form}>
          <ActivityIndicator size="large" color={isAAA ? '#ffdd00' : '#0096ff'} />
          <Text style={[styles.title, isAAA && styles.titleAAA, {marginTop: 24}]}>
            {t('enroll.processing')}
          </Text>
        </View>
      </View>
    );
  }

  // Done / Error
  if (enrollment.step === 'done' || enrollment.step === 'error') {
    return (
      <View style={[styles.container, isAAA && styles.containerAAA]}>
        <View style={styles.form}>
          <Text
            style={[
              styles.title,
              enrollment.step === 'done' ? styles.successText : styles.errorText,
              isAAA && styles.titleAAA,
            ]}>
            {enrollment.step === 'done' ? t('enroll.success') : t('enroll.fail')}
          </Text>
          {enrollment.error && (
            <Text style={[styles.errorDetail, isAAA && {color: '#FFD700'}]}>
              {enrollment.error}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.startBtn, isAAA && styles.startBtnAAA]}
            onPress={() => {
              enrollment.reset();
              navigation.goBack();
            }}>
            <Text style={[styles.startBtnText, isAAA && styles.startBtnTextAAA]}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera capture steps
  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />

      <View style={styles.guideOverlay} pointerEvents="none">
        <View style={[styles.faceGuide, isAAA && styles.faceGuideAAA]} />
      </View>

      <View style={styles.topBar}>
        <EnrollmentProgress
          currentStep={enrollment.stepIndex}
          totalSteps={enrollment.totalSteps}
        />
        <Text style={[styles.stepInstruction, isAAA && styles.stepInstructionAAA]}>
          {t(enrollment.stepLabel)}
        </Text>
      </View>

      {/* Detection bbox removed: face.bounds are raw camera-frame pixels, not
          view dp, so the box rendered mispositioned/oversized. The centered
          dashed oval (faceGuide) is the alignment guide. */}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.captureBtn,
            isAAA && styles.captureBtnAAA,
            !hasFace && styles.captureBtnDisabled,
          ]}
          onPress={handleCapture}
          disabled={!hasFace}>
          <Text
            style={[styles.captureBtnText, isAAA && styles.captureBtnTextAAA]}
            numberOfLines={1}>
            {hasFace ? t('enroll.capture_btn') : t('enroll.no_face')}
          </Text>
        </TouchableOpacity>
      </View>

      {__DEV__ && (
        <View style={styles.debugBar}>
          <Text style={styles.debugText}>
            {fps > 0 ? `${fps} FPS` : ''}
            {detection ? ` | ${detection.confidence.toFixed(2)}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

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
  successText: {color: '#10B981'},
  errorText: {color: '#EF4444'},
  errorDetail: {color: '#FCA5A5', fontSize: 14, textAlign: 'center'},
  guideOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 260,
    height: 340,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
  },
  faceGuideAAA: {borderWidth: 5, borderColor: '#FFD700'},
  topBar: {
    position: 'absolute',
    top: 50, left: 0, right: 0,
    alignItems: 'center',
  },
  stepInstruction: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  stepInstructionAAA: {
    fontSize: 22,
    color: '#FFD700',
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderColor: '#FFD700',
    borderWidth: 2,
  },
  bbox: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: '#10B981',
    borderRadius: 8,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 35,
    left: 0, right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 18,
    paddingHorizontal: 56,
    borderRadius: 999,
    shadowColor: '#3B82F6',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  captureBtnAAA: {
    backgroundColor: '#FFD700',
    paddingVertical: 22,
    paddingHorizontal: 64,
  },
  captureBtnDisabled: {
    backgroundColor: '#475569',
    shadowOpacity: 0,
  },
  captureBtnText: {color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5},
  captureBtnTextAAA: {color: '#000', fontSize: 24},
  debugBar: {
    position: 'absolute',
    top: 130,
    left: 0, right: 0,
    alignItems: 'center',
  },
  debugText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },
});
