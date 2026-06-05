import React, {useEffect, useState, useRef, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  StatusBar,
  Dimensions,
  ScrollView,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useRunOnJS} from 'react-native-worklets-core';
import {useFaceDetector} from 'react-native-vision-camera-face-detector';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {useResizePlugin} from 'vision-camera-resize-plugin';
import {useTranslation} from 'react-i18next';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';

import {extractMLKitSignature} from '../../../ml/processors/mlkitSignature.worklet';
import type {FaceDetection} from '../../../ml/processors/faceDetect.worklet';
import {useFaceAuth} from '../../hooks/useFaceAuth';
import {useVoicePrompt} from '../../components/VoicePrompt';
import {useThemeContext} from '../../theme/ThemeContext';
import {useSession} from '../../auth/sessionStore';
import {getCurrentLocation} from '../../services/locationService';
import {insertPunchEvent} from '../../../storage/db/punchEvents.repo';
import type {RootStackParamList} from '../../navigation/RootStack';
import {initPipeline} from '../../../ml/pipeline';

type Phase = 'liveness' | 'capturing_gps' | 'saving' | 'failed';

// Active-liveness tuning.
const ATTEMPT_SECONDS = 10; // time budget per anti-spoofing attempt
const MAX_ATTEMPTS = 2;
const BLINKS_REQUIRED = 2;
const EYE_OPEN = 0.55; // eye-open probability above this == open
const EYE_CLOSED = 0.3; // below this == closed (hysteresis gap avoids jitter)
const MATCH_HITS_REQUIRED = 4; // CONSECUTIVE frames ≥ threshold (impostor scores
// fluctuate wildly ~0.30–0.72, so requiring several consecutive high frames lets
// the steady genuine worker through while an impostor's spikes can't accumulate)
const ENGINE_UNAVAILABLE_FRAMES = 24; // give up if the face engine never loads
// Graceful degrade: if ML Kit never returns eye-open probabilities on this
// device (some front cameras / formats omit them), fall back to passive
// liveness after the face is held this many frames — so a worker is never
// stranded. Identity match still gates the punch either way.
const FALLBACK_FACE_FRAMES = 50;

const SCREEN_H = Dimensions.get('window').height;
const CARD_H = Math.max(260, Math.min(360, Math.round(SCREEN_H * 0.42)));

const LIGHT = {
  bg: '#FFFFFF',
  text: '#111114',
  sub: '#5C5C66',
  oval: 'rgba(255,255,255,0.92)',
  ovalOk: '#22C55E',
  bannerOk: '#E08A0B',
  bannerOkText: '#FFFFFF',
  bannerNeutralBg: 'rgba(255,255,255,0.16)',
  bannerNeutralText: '#FFFFFF',
  infoBg: '#E8F1FD',
  infoTitle: '#1D4ED8',
  infoSub: '#2451B5', // darker for AA contrast on the light-blue info card
  eyeBg: '#CFE2FB',
  eye: '#1D4ED8',
  barTrack: '#D6E4FB',
  barFill: '#1D4ED8',
  timeVal: '#1D4ED8',
  pillBg: '#F0F1F3',
  pillText: '#3A3A40',
  shield: '#1D4ED8',
  cancel: '#3A3A40',
  danger: '#DC2626',
};
const AAA: typeof LIGHT = {
  bg: '#000000',
  text: '#FFFFFF',
  sub: '#FFD700',
  oval: '#FFD700',
  ovalOk: '#00FF66',
  bannerOk: '#FFA500',
  bannerOkText: '#000000',
  bannerNeutralBg: 'rgba(255,255,255,0.18)',
  bannerNeutralText: '#FFFFFF',
  infoBg: '#1a1a00',
  infoTitle: '#FFD700',
  infoSub: '#FFA500',
  eyeBg: '#241600',
  eye: '#FFD700',
  barTrack: '#332b00',
  barFill: '#FFD700',
  timeVal: '#FFD700',
  pillBg: '#1a1a00',
  pillText: '#FFD700',
  shield: '#FFD700',
  cancel: '#FFD700',
  danger: '#FF4D4D',
};

// ---- Tintable drawn icons (no icon library) ----
function EyeIcon({color, bg}: {color: string; bg: string}) {
  return (
    <View style={[ic.eyeWrap, {backgroundColor: bg}]}>
      {(['tl', 'tr', 'bl', 'br'] as const).map(k => (
        <View key={k} style={[ic.bracket, ic[k], {borderColor: color}]} />
      ))}
      <View style={[ic.iris, {borderColor: color}]}>
        <View style={[ic.pupil, {backgroundColor: color}]} />
      </View>
    </View>
  );
}
function ShieldIcon({color}: {color: string}) {
  return (
    <View style={ic.shield}>
      <View style={[ic.shieldTop, {backgroundColor: color}]} />
      <View style={[ic.shieldTip, {borderTopColor: color}]} />
      <Text style={ic.shieldCheck}>✓</Text>
    </View>
  );
}

export default function PunchCaptureScreen() {
  const {t} = useTranslation();
  const {isAAA} = useThemeContext();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'PunchCapture'>>();
  const punchType: 'in' | 'out' = route.params?.type ?? 'in';
  const P = isAAA ? AAA : LIGHT;
  // useVoicePrompt returns FRESH speak/stop closures every render. Keep them in
  // refs so the callbacks/effects below stay referentially stable — otherwise
  // the per-attempt countdown effect would re-run (and reset the blink counter)
  // on every 100ms tick, and liveness could never complete.
  const {speak, stop} = useVoicePrompt();
  const speakRef = useRef(speak);
  const stopRef = useRef(stop);
  useEffect(() => {
    speakRef.current = speak;
    stopRef.current = stop;
  });

  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const worker = useSession(s => s.worker);

  const [phase, setPhase] = useState<Phase>('liveness');
  const [attempt, setAttempt] = useState(1);
  const [remaining, setRemaining] = useState(ATTEMPT_SECONDS);
  const [blinks, setBlinks] = useState(0);
  const [livenessDone, setLivenessDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const finishedRef = useRef(false);
  const unmountedRef = useRef(false);
  // identity match (consecutive-frame gating)
  const matchHitsRef = useRef(0);
  const missHitsRef = useRef(0);
  const identityOkRef = useRef(false);
  const lastScoreRef = useRef(0);
  const engineUnavailableRef = useRef(0); // consecutive frames with no face engine
  // liveness (blink) state machine
  const eyeStateRef = useRef<'open' | 'closed' | 'unknown'>('unknown');
  const blinkCountRef = useRef(0);
  const livenessOkRef = useRef(false);
  const eyeDataSeenRef = useRef(false); // device actually reports eye-open probs
  const noEyeFramesRef = useRef(0); // consecutive face frames lacking eye data
  const lastPipelineRef = useRef<unknown>(null); // process each frame's result once

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const {hasFace, pipelineResult, onFrameResult, refreshTemplates} = useFaceAuth();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    initPipeline();
    refreshTemplates();
    speakRef.current(t('liveness_check.blink_twice', 'Please blink twice'), true);
    return () => stopRef.current();
  }, [refreshTemplates, t]);

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    minFaceSize: 0.2,
  });

  const edgeface = useTensorflowModel(
    require('../../../../assets/models/edgeface_xs_int8.tflite'),
  );
  const faceModel = edgeface.state === 'loaded' ? edgeface.model : undefined;
  const {resize} = useResizePlugin();

  const onFrameResultJS = useRunOnJS(onFrameResult, [onFrameResult]);

  // ----- Action callbacks (declared before the effects that use them) -----

  const failPunch = useCallback(
    (reason: 'face_mismatch' | 'timeout' | 'no_face' | 'storage_error' | 'spoof' | 'engine_unavailable') => {
      if (unmountedRef.current) return;
      const messages: Record<string, string> = {
        face_mismatch: t('punch_capture.face_mismatch', 'Face does not match your registered profile'),
        timeout: t('punch_capture.timeout', 'Could not detect your face. Please retry in better light.'),
        no_face: t('punch_capture.no_face', 'No face detected'),
        storage_error: t('punch_capture.storage_error', 'Failed to save punch event'),
        spoof: t('punch_capture.spoof', 'Spoof attempt detected'),
        engine_unavailable: t('punch_capture.engine_unavailable', 'Face engine not ready. Please update the app and try again.'),
      };
      setErrorMsg(messages[reason]);
      setPhase('failed');
      speakRef.current(messages[reason], true);
      setTimeout(() => {
        if (unmountedRef.current) return;
        navigation.replace('PunchResult', {success: false, type: punchType, reason});
      }, 1500);
    },
    [navigation, punchType, t],
  );

  const proceedWithPunch = useCallback(
    async (faceScore: number) => {
      if (!worker) return;
      setPhase('capturing_gps');
      speakRef.current(t('punch_capture.gps', 'Capturing location...'), true);

      const loc = await getCurrentLocation(8000);
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
          livenessPassed: true, // real: two blinks were detected this session
        });
      } catch (e: any) {
        if (!unmountedRef.current) failPunch('storage_error');
        return;
      }

      if (unmountedRef.current) return;
      const ts = Date.now();
      speakRef.current(
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
    [worker, punchType, navigation, t, failPunch],
  );

  // Punch only once BOTH gates pass: liveness (2 blinks) + identity match.
  const maybeComplete = useCallback(() => {
    if (finishedRef.current || unmountedRef.current) return;
    if (livenessOkRef.current && identityOkRef.current) {
      finishedRef.current = true;
      proceedWithPunch(lastScoreRef.current);
    }
  }, [proceedWithPunch]);

  // Out of time for the current attempt → next attempt, or fail after the last.
  const handleAttemptTimeout = useCallback(() => {
    if (finishedRef.current || unmountedRef.current) return;
    setAttempt(a => {
      if (a < MAX_ATTEMPTS) return a + 1; // the per-attempt effect resets + restarts
      finishedRef.current = true;
      failPunch('timeout');
      return a;
    });
  }, [failPunch]);

  // Read the latest timeout handler via a ref so the countdown effect depends
  // only on [phase, attempt] and never restarts itself mid-tick.
  const attemptTimeoutRef = useRef(handleAttemptTimeout);
  useEffect(() => {
    attemptTimeoutRef.current = handleAttemptTimeout;
  });

  // Blink detector (runs on JS from the frame worklet). prob<0 == no usable face.
  const onEyes = useCallback(
    (prob: number) => {
      if (finishedRef.current || livenessOkRef.current) return;
      if (prob <= -2) {
        // No face — don't advance the passive-liveness fallback counter.
        noEyeFramesRef.current = 0;
        return;
      }
      if (prob < 0) {
        // Face present but this device/format gave no eye-open probability.
        // Only fall back if we've NEVER seen real eye data (so devices that do
        // report blinks always require a real blink).
        if (!eyeDataSeenRef.current) {
          noEyeFramesRef.current += 1;
          if (noEyeFramesRef.current >= FALLBACK_FACE_FRAMES) {
            livenessOkRef.current = true;
            setLivenessDone(true);
            maybeComplete();
          }
        }
        return;
      }
      // Real eye data → genuine blink detection.
      eyeDataSeenRef.current = true;
      noEyeFramesRef.current = 0;
      if (prob < EYE_CLOSED) {
        eyeStateRef.current = 'closed';
      } else if (prob > EYE_OPEN) {
        if (eyeStateRef.current === 'closed') {
          const n = blinkCountRef.current + 1;
          blinkCountRef.current = n;
          setBlinks(n);
          if (n >= BLINKS_REQUIRED) {
            livenessOkRef.current = true;
            setLivenessDone(true);
            speakRef.current(t('liveness_check.blink_detected', 'Blink detected!'), true);
            maybeComplete();
          }
        }
        eyeStateRef.current = 'open';
      }
    },
    [maybeComplete, t],
  );
  const onEyesJS = useRunOnJS(onEyes, [onEyes]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const start = performance.now();
      try {
        const faces = faceDetector.detectFaces(frame);
        const latency = performance.now() - start;
        if (faces.length === 0) {
          onFrameResultJS(null, null, latency);
          onEyesJS(-2); // -2 = no face (vs -1 = face but no eye data)
          return;
        }
        const fc = faces[0];
        const b = fc.bounds ?? {};
        const det: FaceDetection = {
          x: b.x ?? 0,
          y: b.y ?? 0,
          width: b.width ?? 0,
          height: b.height ?? 0,
          confidence: 1.0,
          landmarks: [],
        };
        // Eye-open probabilities for blink-based liveness.
        const le = fc.leftEyeOpenProbability;
        const re = fc.rightEyeOpenProbability;
        let eyes = -1;
        if (typeof le === 'number' && typeof re === 'number' && le >= 0 && re >= 0) {
          eyes = (le + re) / 2;
        }
        onEyesJS(eyes);
        // EdgeFace embedding for identity match.
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
            // (The old `/127.5 - 1.0` assumed [0,255] and squashed every pixel to
            // ~-1.0, making all faces produce near-identical embeddings → every
            // face matched every face.)
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
        if (!emb) emb = extractMLKitSignature(fc, frame.width, frame.height);
        onFrameResultJS(det, emb, latency);
      } catch {}
    },
    [faceDetector, onFrameResultJS, onEyesJS, faceModel, resize],
  );

  // Identity match — runs concurrently with the blink challenge. The punch is
  // gated on MATCH_HITS_REQUIRED *consecutive* frames that match THIS worker, so
  // we process EVERY new pipeline result (not only 'matched' ones) and reset the
  // streak on any frame that isn't this worker. Without that reset, two
  // borderline frames anywhere in the 10s window would satisfy the gate and let
  // a DIFFERENT person punch out (the reported bug).
  useEffect(() => {
    if (finishedRef.current || !worker || !pipelineResult) return;
    // Each frame's result object is processed exactly once.
    if (lastPipelineRef.current === pipelineResult) return;
    lastPipelineRef.current = pipelineResult;

    const stage = pipelineResult.stage;

    // The face engine never produced a real EdgeFace embedding (tflite model not
    // loaded → pipeline fails closed with this reason). Count these frames and
    // bail with a clear message rather than silently timing out / accepting.
    if (
      stage === 'low_quality' &&
      pipelineResult.quality?.reason === 'face_engine_unavailable'
    ) {
      matchHitsRef.current = 0;
      engineUnavailableRef.current += 1;
      if (engineUnavailableRef.current >= ENGINE_UNAVAILABLE_FRAMES) {
        finishedRef.current = true;
        failPunch('engine_unavailable');
      }
      return;
    }
    engineUnavailableRef.current = 0;

    // A dropped detection (no face this frame) must not nuke a genuine streak.
    if (stage === 'no_face') return;

    if (stage === 'matched' && pipelineResult.match) {
      const m = pipelineResult.match;
      const expectedUserId = `worker-${worker.id}`;
      const identityMatches = m.userId
        ? m.userId === expectedUserId
        : m.name.trim().toLowerCase() === worker.name.trim().toLowerCase();

      if (identityMatches) {
        matchHitsRef.current += 1;
        missHitsRef.current = 0;
        lastScoreRef.current = m.score;
        if (matchHitsRef.current >= MATCH_HITS_REQUIRED) {
          identityOkRef.current = true;
          maybeComplete();
        }
      } else {
        // Matched a DIFFERENT enrolled worker → break the streak, drop the
        // identity gate, and reject early if it persists.
        matchHitsRef.current = 0;
        identityOkRef.current = false;
        missHitsRef.current += 1;
        if (missHitsRef.current >= 6) {
          finishedRef.current = true;
          failPunch('face_mismatch');
        }
      }
    } else {
      // 'no_match' / 'low_quality' / 'no_templates': a face is present but it is
      // NOT this worker (below threshold). Break the consecutive streak AND drop
      // the identity gate. Un-latching here is what stops the swap attack: if the
      // worker's face verifies first (latching identity) and a DIFFERENT face is
      // then shown to do the blink, these no_match frames clear identityOk so the
      // punch can't complete on someone else's face. The genuine worker, who
      // keeps matching at ~0.85, re-establishes 3 consecutive matches instantly.
      // Do NOT increment missHits — sub-threshold frames in poor light are normal
      // for the genuine worker and must not trip the early hard-reject.
      matchHitsRef.current = 0;
      identityOkRef.current = false;
    }
  }, [pipelineResult, worker, maybeComplete, failPunch]);

  // Per-attempt countdown: resets liveness/identity gates, ticks the timer,
  // and hands off to handleAttemptTimeout when it reaches zero.
  useEffect(() => {
    if (phase !== 'liveness') return;

    blinkCountRef.current = 0;
    setBlinks(0);
    livenessOkRef.current = false;
    setLivenessDone(false);
    identityOkRef.current = false;
    matchHitsRef.current = 0;
    missHitsRef.current = 0;
    engineUnavailableRef.current = 0;
    eyeStateRef.current = 'unknown';
    noEyeFramesRef.current = 0;

    const start = Date.now();
    setRemaining(ATTEMPT_SECONDS);
    const id = setInterval(() => {
      const rem = Math.max(0, ATTEMPT_SECONDS - (Date.now() - start) / 1000);
      setRemaining(rem);
      if (rem <= 0) {
        clearInterval(id);
        attemptTimeoutRef.current();
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, attempt]);

  // ---- Permission / device gates ----
  if (!hasPermission) {
    return (
      <View style={[styles.center, {backgroundColor: P.bg}]}>
        <Text style={[styles.msg, {color: P.text}]}>{t('common.camera_required')}</Text>
        <TouchableOpacity
          style={[styles.permBtn, {backgroundColor: P.barFill}]}
          onPress={() =>
            requestPermission().then(g => {
              if (!g) Linking.openSettings();
            })
          }>
          <Text style={styles.permBtnText}>{t('common.grant_permission')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[styles.center, {backgroundColor: P.bg}]}>
        <Text style={[styles.msg, {color: P.text}]}>{t('common.no_camera')}</Text>
      </View>
    );
  }

  // ---- Non-liveness phases: simple centered status ----
  if (phase !== 'liveness') {
    return (
      <View style={[styles.center, {backgroundColor: P.bg}]}>
        <StatusBar barStyle={isAAA ? 'light-content' : 'dark-content'} backgroundColor={P.bg} />
        {phase === 'failed' ? (
          <Text style={[styles.statusMsg, {color: P.danger}]}>{errorMsg}</Text>
        ) : (
          <>
            <ActivityIndicator size="large" color={P.barFill} />
            <Text style={[styles.statusMsg, {color: P.text}]}>
              {phase === 'capturing_gps'
                ? t('punch_capture.gps', 'Capturing location...')
                : t('punch_capture.saving', 'Saving...')}
            </Text>
          </>
        )}
      </View>
    );
  }

  // ---- Liveness Check UI (mockup) ----
  const bannerOk = livenessDone || blinks >= 1;
  const bannerText = livenessDone
    ? t('liveness_check.blink_detected', 'Blink detected!')
    : blinks >= 1
    ? t('liveness_check.blink_progress', {n: blinks, total: BLINKS_REQUIRED, defaultValue: 'Blink {{n}} of {{total}}'})
    : hasFace
    ? t('liveness_check.look_camera', 'Look directly at the camera')
    : t('liveness_check.position_face', 'Position your face in the oval');

  return (
    <View style={[styles.screen, {backgroundColor: P.bg}]}>
      <StatusBar barStyle={isAAA ? 'light-content' : 'dark-content'} backgroundColor={P.bg} />

      <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()} hitSlop={12}>
        <Text style={[styles.cancelText, {color: P.cancel}]}>✕</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
      <Text style={[styles.title, {color: P.text}]}>
        {t('liveness_check.title', 'Liveness Check')}
      </Text>

      {/* Camera card */}
      <View style={styles.card}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
        <View style={styles.ovalWrap} pointerEvents="none">
          <View style={[styles.oval, {borderColor: hasFace ? P.ovalOk : P.oval}]} />
        </View>
        <View
          style={[
            styles.banner,
            {backgroundColor: bannerOk ? P.bannerOk : P.bannerNeutralBg},
          ]}>
          {bannerOk && <Text style={[styles.bannerCheck, {color: P.bannerOkText}]}>✓</Text>}
          <Text
            style={[styles.bannerText, {color: bannerOk ? P.bannerOkText : P.bannerNeutralText}]}
            numberOfLines={1}>
            {bannerText}
          </Text>
          {livenessDone && <Text style={[styles.bannerCheck, {color: P.bannerOkText}]}>✓</Text>}
        </View>
      </View>

      {/* DIAGNOSTIC readout — live cosine score vs the enrolled template,
          REGARDLESS of the accept gate. Point at your own face vs a different
          face and read the two scores to set the threshold from real data. */}
      <View style={styles.dbgBox}>
        <Text style={styles.dbgLabel} numberOfLines={1}>
          match: {pipelineResult?.bestName ?? '—'}  ·  stage: {pipelineResult?.stage ?? '—'}
        </Text>
        <Text style={styles.dbgScore}>
          cosine {pipelineResult?.bestScore != null ? pipelineResult.bestScore.toFixed(3) : '—'}
        </Text>
      </View>

      {/* Challenge info card */}
      <View style={[styles.info, {backgroundColor: P.infoBg}]}>
        <EyeIcon color={P.eye} bg={P.eyeBg} />
        <View style={styles.infoTextWrap}>
          <Text style={[styles.infoTitle, {color: P.infoTitle}]}>
            {livenessDone
              ? t('liveness_check.hold_still', 'Hold still')
              : t('liveness_check.blink_twice', 'Please blink twice')}
          </Text>
          <Text style={[styles.infoSub, {color: P.infoSub}]}>
            {livenessDone
              ? t('liveness_check.verifying', 'Verifying your identity…')
              : t('liveness_check.look_camera', 'Look directly at the camera')}
          </Text>
        </View>
      </View>

      {/* Time remaining */}
      <View style={styles.timeRow}>
        <Text style={[styles.timeLabel, {color: P.text}]}>
          {t('liveness_check.time_remaining', 'Time remaining')}
        </Text>
        <Text style={[styles.timeVal, {color: P.timeVal}]}>{remaining.toFixed(1)}s</Text>
      </View>
      <View style={[styles.barTrack, {backgroundColor: P.barTrack}]}>
        <View
          style={[
            styles.barFill,
            {backgroundColor: P.barFill, width: `${(remaining / ATTEMPT_SECONDS) * 100}%`},
          ]}
        />
      </View>

      {/* Anti-spoofing attempt pill */}
      <View style={[styles.pill, {backgroundColor: P.pillBg}]}>
        <ShieldIcon color={P.shield} />
        <Text style={[styles.pillText, {color: P.pillText}]} numberOfLines={1}>
          {t('liveness_check.anti_spoofing', 'Anti-spoofing')} ·{' '}
          {t('liveness_check.attempt_label', 'Attempt')}{' '}
          <Text style={styles.pillBold}>{attempt}</Text>{' '}
          {t('liveness_check.of', 'of')} <Text style={styles.pillBold}>{MAX_ATTEMPTS}</Text>
        </Text>
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  scroll: {paddingHorizontal: 22, paddingTop: 54, paddingBottom: 28},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16},
  msg: {textAlign: 'center', fontSize: 16},
  statusMsg: {textAlign: 'center', fontSize: 17, fontWeight: '600', marginTop: 8},
  permBtn: {paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12},
  permBtnText: {color: '#fff', fontWeight: '700', fontSize: 16},
  cancel: {position: 'absolute', top: 50, left: 18, padding: 8, zIndex: 10},
  cancelText: {fontSize: 24, fontWeight: '700'},
  title: {fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 16, letterSpacing: 0.3},
  card: {
    height: CARD_H,
    borderRadius: 24,
    backgroundColor: '#0B0B0F',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovalWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {width: 168, height: 224, borderRadius: 112, borderWidth: 3},
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  bannerCheck: {fontSize: 18, fontWeight: '900'},
  bannerText: {fontSize: 19, fontWeight: '800', flexShrink: 1},
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderRadius: 18,
    marginTop: 18,
  },
  infoTextWrap: {flex: 1},
  infoTitle: {fontSize: 22, fontWeight: '800'},
  infoSub: {fontSize: 16, fontWeight: '500', marginTop: 2},
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 26,
    marginBottom: 10,
  },
  timeLabel: {fontSize: 18, fontWeight: '600'},
  timeVal: {fontSize: 20, fontWeight: '800'},
  barTrack: {height: 8, borderRadius: 4, overflow: 'hidden'},
  barFill: {height: '100%', borderRadius: 4},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  pillText: {fontSize: 16, fontWeight: '600', flexShrink: 1},
  pillBold: {fontWeight: '800'},
  dbgBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
  },
  dbgLabel: {fontSize: 13, fontWeight: '700', color: '#7F1D1D'},
  dbgScore: {fontSize: 26, fontWeight: '900', color: '#DC2626', marginTop: 2},
});

const ic = StyleSheet.create({
  eyeWrap: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  bracket: {position: 'absolute', width: 10, height: 10},
  tl: {top: 10, left: 10, borderTopWidth: 2.5, borderLeftWidth: 2.5},
  tr: {top: 10, right: 10, borderTopWidth: 2.5, borderRightWidth: 2.5},
  bl: {bottom: 10, left: 10, borderBottomWidth: 2.5, borderLeftWidth: 2.5},
  br: {bottom: 10, right: 10, borderBottomWidth: 2.5, borderRightWidth: 2.5},
  iris: {width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center'},
  pupil: {width: 7, height: 7, borderRadius: 4},
  shield: {width: 22, height: 24, alignItems: 'center'},
  shieldTop: {width: 18, height: 12, borderTopLeftRadius: 4, borderTopRightRadius: 4},
  shieldTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  shieldCheck: {position: 'absolute', top: 2, color: '#fff', fontSize: 11, fontWeight: '900'},
});
