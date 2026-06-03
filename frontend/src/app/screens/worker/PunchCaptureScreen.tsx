import React, {useEffect, useState, useRef, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useRunOnJS} from 'react-native-worklets-core';
import {useFaceDetector} from 'react-native-vision-camera-face-detector';
import {useTranslation} from 'react-i18next';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';

import {extractMLKitSignature} from '../../../ml/processors/mlkitSignature.worklet';
import type {FaceDetection} from '../../../ml/processors/faceDetect.worklet';
import {useFaceAuth} from '../../hooks/useFaceAuth';
import {useVoicePrompt} from '../../components/VoicePrompt';
import {useThemeContext} from '../../theme/ThemeContext';
import {COLORS, FONTS, SPACING, RADIUS} from '../../theme/aaaTheme';
import {useSession} from '../../auth/sessionStore';
import {getCurrentLocation} from '../../services/locationService';
import {insertPunchEvent} from '../../../storage/db/punchEvents.repo';
import type {RootStackParamList} from '../../navigation/RootStack';
import {initPipeline} from '../../../ml/pipeline';

type Phase = 'aligning' | 'capturing_gps' | 'saving' | 'failed';

export default function PunchCaptureScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'PunchCapture'>>();
  const punchType: 'in' | 'out' = route.params?.type ?? 'in';
  const c = isAAA ? COLORS.aaa : COLORS.normal;
  const f = isAAA ? FONTS.aaa : FONTS.normal;
  const {speak, stop} = useVoicePrompt();

  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const worker = useSession(s => s.worker);

  const [phase, setPhase] = useState<Phase>('aligning');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const finishedRef = useRef(false);
  // Separate CONSECUTIVE counters: a frame that matches THIS worker advances
  // matchHits (and resets missHits) and vice-versa. A shared counter would let
  // stray frames of another enrolled identity pre-charge the gate (false accept)
  // or a single stray mismatch trip a reject for a genuine worker.
  const matchHitsRef = useRef(0);
  const missHitsRef = useRef(0);
  // Tracks whether the screen has been unmounted so async tasks that finish
  // after the user pressed ✕ don't try to navigate the (now-popped) screen.
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const {
    detection,
    hasFace,
    pipelineResult,
    latestEmbeddingRef,
    onFrameResult,
    refreshTemplates,
  } = useFaceAuth();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    initPipeline();
    refreshTemplates();
    speak(
      punchType === 'in'
        ? t('punch_capture.prompt_in', 'Look at the camera to punch in')
        : t('punch_capture.prompt_out', 'Look at the camera to punch out'),
      true,
    );
    return () => stop();
  }, [punchType, refreshTemplates, speak, stop, t]);

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    minFaceSize: 0.2,
  });

  const onFrameResultJS = useRunOnJS(onFrameResult, [onFrameResult]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const start = performance.now();
      try {
        const faces = faceDetector.detectFaces(frame);
        const latency = performance.now() - start;
        if (faces.length > 0) {
          const fc = faces[0];
          const det: FaceDetection = {
            x: fc.bounds?.x ?? 0,
            y: fc.bounds?.y ?? 0,
            width: fc.bounds?.width ?? 0,
            height: fc.bounds?.height ?? 0,
            confidence: 1.0,
            landmarks: [],
          };
          const sig = extractMLKitSignature(fc, frame.width, frame.height);
          onFrameResultJS(det, sig, latency);
        } else {
          onFrameResultJS(null, null, latency);
        }
      } catch {}
    },
    [faceDetector, onFrameResultJS],
  );

  // ----- Action callbacks (declared BEFORE the effects that reference them so
  //       TypeScript's TDZ check doesn't flag dep-array entries) -----

  // `failPunch` is referenced by `proceedWithPunch` on storage failure, so it
  // is declared first.
  const failPunch = useCallback(
    (reason: 'face_mismatch' | 'timeout' | 'no_face' | 'storage_error' | 'spoof') => {
      if (unmountedRef.current) return;
      const messages: Record<string, string> = {
        face_mismatch: t('punch_capture.face_mismatch', 'Face does not match your registered profile'),
        timeout: t('punch_capture.timeout', 'Could not detect your face. Please retry in better light.'),
        no_face: t('punch_capture.no_face', 'No face detected'),
        storage_error: t('punch_capture.storage_error', 'Failed to save punch event'),
        spoof: t('punch_capture.spoof', 'Spoof attempt detected'),
      };
      setErrorMsg(messages[reason]);
      setPhase('failed');
      speak(messages[reason], true);
      setTimeout(() => {
        if (unmountedRef.current) return;
        navigation.replace('PunchResult', {
          success: false,
          type: punchType,
          reason,
        });
      }, 1500);
    },
    [navigation, punchType, speak, t],
  );

  const proceedWithPunch = useCallback(
    async (faceScore: number) => {
      if (!worker) return;
      setPhase('capturing_gps');
      speak(t('punch_capture.gps', 'Capturing location...'), true);

      const loc = await getCurrentLocation(8000);
      // If the user cancelled while GPS was resolving, drop the result on the floor.
      if (unmountedRef.current) return;

      setPhase('saving');
      try {
        insertPunchEvent({
          workerId: worker.id,
          type: punchType,
          gpsLat: loc.ok ? loc.fix.lat : null,
          gpsLon: loc.ok ? loc.fix.lon : null,
          gpsAccuracy: loc.ok ? loc.fix.accuracy : null,
          faceMatchScore: faceScore,
          livenessPassed: true,
        });
      } catch (e: any) {
        if (!unmountedRef.current) failPunch('storage_error');
        return;
      }

      // No auto-sync here — the event is saved locally (synced=0) and the
      // worker uploads it explicitly via the "Sync Now" button on the home
      // screen (only when online). Keeps sync fully worker-initiated.

      if (unmountedRef.current) return;
      const ts = Date.now();
      speak(
        punchType === 'in'
          ? t('punch_capture.success_in', 'Punched in successfully')
          : t('punch_capture.success_out', 'Punched out successfully'),
        true,
      );
      navigation.replace('PunchResult', {
        success: true,
        type: punchType,
        timestamp: ts,
        gpsAvailable: loc.ok,
      });
    },
    [worker, punchType, navigation, speak, t, failPunch],
  );

  // ----- Effects (now safe to reference proceedWithPunch / failPunch) -----

  // Watch pipeline result — auto-advance when match found
  useEffect(() => {
    if (finishedRef.current || !worker) return;
    if (!pipelineResult) return;

    if (pipelineResult.stage === 'matched' && pipelineResult.match) {
      // Bind the matched template to THIS worker's enrolled identity by its
      // `userId` (`worker-<uuid>`) — two workers can share a display name but
      // never a registry uuid, so name-only matching would let same-named
      // workers on a shared device punch as each other. Fall back to name only
      // for legacy templates enrolled before the userId convention.
      const m = pipelineResult.match;
      const expectedUserId = `worker-${worker.id}`;
      const identityMatches = m.userId
        ? m.userId === expectedUserId
        : m.name.trim().toLowerCase() === worker.name.trim().toLowerCase();

      if (identityMatches) {
        matchHitsRef.current += 1;
        missHitsRef.current = 0;
      } else {
        missHitsRef.current += 1;
        matchHitsRef.current = 0;
      }

      if (matchHitsRef.current >= 2) {
        // Two CONSECUTIVE frames matched this worker — proceed
        finishedRef.current = true;
        proceedWithPunch(m.score);
      } else if (missHitsRef.current >= 5) {
        // Five consecutive frames matched someone else / didn't match — reject
        finishedRef.current = true;
        failPunch('face_mismatch');
      }
    }
  }, [pipelineResult, worker, proceedWithPunch, failPunch]);

  // Progress animation: 0 → 1 over 8 sec while aligning, then time out.
  // (`intervalId` deliberately not named `t` — the outer scope already binds
  // `t` to the i18n translator from useTranslation().)
  useEffect(() => {
    if (phase !== 'aligning') return;
    const start = Date.now();
    const intervalId = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 8000);
      setProgress(p);
      if (p >= 1) {
        clearInterval(intervalId);
        if (!finishedRef.current && !unmountedRef.current) {
          finishedRef.current = true;
          failPunch('timeout');
        }
      }
    }, 100);
    return () => clearInterval(intervalId);
  }, [phase, failPunch]);

  if (!hasPermission) {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <Text style={[styles.msg, {color: c.text, fontSize: f.bodyLg}]}>
          {t('common.camera_required')}
        </Text>
        <TouchableOpacity
          style={[styles.btn, {backgroundColor: c.primary}]}
          onPress={() =>
            requestPermission().then(g => {
              if (!g) Linking.openSettings();
            })
          }>
          <Text style={[styles.btnText, {color: isAAA ? '#000' : '#FFF'}]}>
            {t('common.grant_permission')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <Text style={[styles.msg, {color: c.text, fontSize: f.bodyLg}]}>
          {t('common.no_camera')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={phase === 'aligning'}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />

      {/* Oval guide */}
      <View style={styles.overlay} pointerEvents="none">
        <View
          style={[
            styles.oval,
            {
              borderColor: hasFace ? c.success : 'rgba(255,255,255,0.6)',
              borderWidth: hasFace ? 4 : 3,
            },
          ]}
        />
      </View>

      {/* Top header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={[styles.headerText, {fontSize: f.title}]}>
          {punchType === 'in' ? t('punch_capture.title_in', 'Punch In') : t('punch_capture.title_out', 'Punch Out')}
        </Text>
        <View style={{width: 44}} />
      </View>

      {/* Bottom card */}
      <View style={[styles.bottomCard, {backgroundColor: 'rgba(15, 23, 42, 0.92)'}]}>
        {phase === 'aligning' && (
          <>
            <Text style={[styles.prompt, {fontSize: f.title}]}>
              {hasFace
                ? t('punch_capture.hold', 'Hold still...')
                : t('punch_capture.look', 'Look at the camera')}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, {width: `${progress * 100}%`}]} />
            </View>
          </>
        )}
        {phase === 'capturing_gps' && (
          <>
            <ActivityIndicator color="#FFF" size="large" />
            <Text style={[styles.prompt, {fontSize: f.body, marginTop: SPACING.sm}]}>
              {t('punch_capture.gps', 'Capturing location...')}
            </Text>
          </>
        )}
        {phase === 'saving' && (
          <>
            <ActivityIndicator color="#FFF" size="large" />
            <Text style={[styles.prompt, {fontSize: f.body, marginTop: SPACING.sm}]}>
              {t('punch_capture.saving', 'Saving...')}
            </Text>
          </>
        )}
        {phase === 'failed' && errorMsg && (
          <Text style={[styles.errMsg, {fontSize: f.body}]}>{errorMsg}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg},
  msg: {textAlign: 'center', marginBottom: SPACING.lg},
  btn: {paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.md},
  btnText: {fontWeight: '700'},
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  oval: {
    width: 280,
    height: 360,
    borderRadius: 140,
    borderStyle: 'solid',
  },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
  },
  cancelBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {color: '#FFF', fontSize: 22, fontWeight: '700'},
  headerText: {
    color: '#FFF',
    fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
  },
  bottomCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  prompt: {color: '#FFF', fontWeight: '700', textAlign: 'center'},
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    marginTop: SPACING.sm,
  },
  progressFill: {height: '100%', backgroundColor: '#10B981'},
  errMsg: {color: '#FCA5A5', textAlign: 'center', fontWeight: '700'},
});
