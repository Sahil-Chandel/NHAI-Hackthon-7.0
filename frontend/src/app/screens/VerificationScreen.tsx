import React, {useEffect, useState, useCallback} from 'react';
import {StyleSheet, Text, View, TouchableOpacity, Linking} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {useRunOnJS, useSharedValue} from 'react-native-worklets-core';
import {useFaceDetector} from 'react-native-vision-camera-face-detector';
import {useTranslation} from 'react-i18next';
import {useNavigation} from '@react-navigation/native';

import type {FaceDetection} from '../../ml/processors/faceDetect.worklet';
import {extractMLKitSignature} from '../../ml/processors/mlkitSignature.worklet';
import {runAntiSpoof} from '../../ml/processors/antiSpoof.worklet';
import {useFaceAuth} from '../hooks/useFaceAuth';
import {useLiveness} from '../hooks/useLiveness';
import {useVoicePrompt} from '../components/VoicePrompt';
import AuthResultBanner from '../components/AuthResultBanner';
import LivenessChallengeOverlay from '../components/LivenessChallengeOverlay';
import {useThemeContext} from '../theme/ThemeContext';
import {enqueueEvent} from '../../sync/syncWorker';
import {recordScore} from '../../ml/processors/adaptiveThreshold';
import type {FaceData} from '../../ml/challenges/challengeEngine';

type VerifyPhase = 'idle' | 'liveness' | 'verifying' | 'done';

export default function VerificationScreen() {
  const {t} = useTranslation();
  const navigation = useNavigation();
  const {isAAA} = useThemeContext();
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const {speak} = useVoicePrompt();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');
  const [spoofResult, setSpoofResult] = useState<{isReal: boolean; score: number} | null>(null);
  const verifyPhaseShared = useSharedValue<VerifyPhase>('idle');
  const spoofCheckedShared = useSharedValue(false);

  const {detection, pipelineResult, fps, templateCount, init, onFrameResult} =
    useFaceAuth();
  const liveness = useLiveness();

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    minFaceSize: 0.2,
  });

  const antiSpoofV2 = useTensorflowModel(
    require('../../../assets/models/minifasnet_v2.tflite'),
  );
  const antiSpoofV1SE = useTensorflowModel(
    require('../../../assets/models/minifasnet_v1se.tflite'),
  );

  const antiSpoofV2Model = antiSpoofV2.state === 'loaded' ? antiSpoofV2.model : undefined;
  const antiSpoofV1SEModel = antiSpoofV1SE.state === 'loaded' ? antiSpoofV1SE.model : undefined;

  useEffect(() => {
    init();
  }, [init]);

  const handleStartLiveness = useCallback(() => {
    liveness.start();
    setVerifyPhase('liveness');
    verifyPhaseShared.value = 'liveness';
    speak(t('liveness.checking'), true);
  }, [liveness, speak, t]);

  const handleLivenessFaceData = useCallback(
    (face: FaceData) => {
      liveness.processFace(face);
    },
    [liveness],
  );

  const handleSpoofResult = useCallback(
    (isReal: boolean, score: number) => {
      setSpoofResult({isReal, score});
      if (!isReal) {
        speak(t('liveness.spoof_detected'), true);
        setVerifyPhase('done');
        verifyPhaseShared.value = 'done';
      }
    },
    [speak, t],
  );

  // Transition from liveness passed → anti-spoof check
  useEffect(() => {
    if (liveness.phase === 'passed' && verifyPhase === 'liveness') {
      speak(t('liveness.passed'), false);
      setVerifyPhase('verifying');
      verifyPhaseShared.value = 'verifying';
    } else if (liveness.phase === 'failed' && verifyPhase === 'liveness') {
      speak(t('liveness.failed'), true);
      setVerifyPhase('done');
      verifyPhaseShared.value = 'done';
    }
  }, [liveness.phase, verifyPhase, speak, t]);

  useEffect(() => {
    if (liveness.faceLost && verifyPhase === 'liveness') {
      speak(t('liveness.face_lost'), false);
    }
  }, [liveness.faceLost, verifyPhase, speak, t]);

  const handleRetry = useCallback(() => {
    liveness.reset();
    setSpoofResult(null);
    spoofCheckedShared.value = false;
    setVerifyPhase('idle');
    verifyPhaseShared.value = 'idle';
  }, [liveness]);

  const onFrameResultJS = useRunOnJS(onFrameResult, [onFrameResult]);
  const handleLivenessFaceJS = useRunOnJS(handleLivenessFaceData, [handleLivenessFaceData]);
  const handleSpoofJS = useRunOnJS(handleSpoofResult, [handleSpoofResult]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      const phase = verifyPhaseShared.value as VerifyPhase;

      // During liveness, run ML Kit face detector for challenge data
      if (phase === 'liveness') {
        try {
          const faces = faceDetector.detectFaces(frame);
          if (faces.length > 0) {
            const f = faces[0];
            const faceData: FaceData = {
              leftEyeOpenProbability: f.leftEyeOpenProbability ?? 1,
              rightEyeOpenProbability: f.rightEyeOpenProbability ?? 1,
              smilingProbability: f.smilingProbability ?? 0,
              yawAngle: f.yawAngle ?? 0,
            };
            handleLivenessFaceJS(faceData);
          }
        } catch {}
        return;
      }

      // During verifying, run anti-spoof once, then recognition
      if (phase === 'verifying') {
        if (!spoofCheckedShared.value && antiSpoofV2Model && antiSpoofV1SEModel) {
          spoofCheckedShared.value = true;
          const spoofOut = runAntiSpoof(
            antiSpoofV2Model,
            antiSpoofV1SEModel,
            frame as any,
          );
          if (spoofOut) {
            handleSpoofJS(spoofOut.isReal, spoofOut.realScore);
            if (!spoofOut.isReal) return;
          }
        }

        // Face recognition via ML Kit landmarks → 512-d signature
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
      }
    },
    [
      verifyPhaseShared,
      spoofCheckedShared,
      antiSpoofV2Model,
      antiSpoofV1SEModel,
      faceDetector,
      onFrameResultJS,
      handleLivenessFaceJS,
      handleSpoofJS,
    ],
  );

  useEffect(() => {
    if (pipelineResult?.stage === 'matched' && verifyPhase === 'verifying') {
      speak(
        t('verify.matched', {name: pipelineResult.match?.name ?? ''}),
        true,
      );
      setVerifyPhase('done');
      verifyPhaseShared.value = 'done';

      const match = pipelineResult.match;
      if (match) {
        enqueueEvent({
          event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          user_id: match.userId,
          user_name: match.name,
          device_id: 'device-01',
          timestamp: new Date().toISOString(),
          cosine_score: match.score,
          liveness_passed: true,
          pad_score: spoofResult?.score,
          latency_ms: pipelineResult.embeddingLatencyMs,
          bio_hash_verified: pipelineResult.bioHashVerified,
          bio_hash_distance: pipelineResult.bioHashDistance,
        });
        recordScore(match.userId, match.score).catch(() => {});
      }
    }
  }, [pipelineResult?.stage, pipelineResult?.match?.name, speak, t, verifyPhase, spoofResult]);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t('common.camera_required')}</Text>
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
      <View style={styles.container}>
        <Text style={styles.message}>{t('common.no_camera')}</Text>
      </View>
    );
  }

  const modelsLoading =
    antiSpoofV2.state === 'loading' ||
    antiSpoofV1SE.state === 'loading';

  const showRecognitionResult = verifyPhase === 'verifying' || verifyPhase === 'done';

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />

      {/* Face guide overlay */}
      <View style={styles.guideOverlay} pointerEvents="none">
        <View
          style={[
            styles.faceGuide,
            isAAA && styles.faceGuideAAA,
            showRecognitionResult &&
              pipelineResult?.stage === 'matched' &&
              styles.faceGuideMatch,
            showRecognitionResult &&
              pipelineResult?.stage === 'no_match' &&
              styles.faceGuideReject,
            spoofResult && !spoofResult.isReal && styles.faceGuideReject,
          ]}
        />
      </View>

      {/* Idle phase — start button */}
      {verifyPhase === 'idle' && (
        <View style={styles.startOverlay}>
          {modelsLoading ? (
            <View style={styles.instructionPill}>
              <Text style={[styles.instruction, isAAA && styles.instructionAAA]}>
                {t('common.loading')}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.instructionPill}>
                <Text style={[styles.instruction, isAAA && styles.instructionAAA]}>
                  📍 {t('verify.position_face')}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.startBtn, isAAA && styles.startBtnAAA]}
                onPress={handleStartLiveness}>
                <Text style={[styles.startBtnText, isAAA && styles.startBtnTextAAA]}>
                  ▶  {t('liveness.start')}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Liveness phase — challenge overlay */}
      {verifyPhase === 'liveness' && (
        <>
          <LivenessChallengeOverlay
            phase={liveness.phase}
            currentStep={liveness.currentStep}
            stepIndex={liveness.stepIndex}
            totalSteps={liveness.totalSteps}
          />
          {liveness.faceLost && (
            <View style={styles.faceLostBanner}>
              <Text style={[styles.faceLostText, isAAA && styles.faceLostTextAAA]}>
                {t('liveness.face_lost')}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Spoof detected banner */}
      {spoofResult && !spoofResult.isReal && (
        <View style={styles.spoofBanner}>
          <Text style={[styles.spoofText, isAAA && styles.spoofTextAAA]}>
            {t('liveness.spoof_detected')}
          </Text>
        </View>
      )}

      {/* Recognition result */}
      {showRecognitionResult && spoofResult?.isReal !== false && (
        <AuthResultBanner result={pipelineResult} />
      )}

      {/* Retry / Back buttons */}
      <View style={styles.bottomBar}>
        {verifyPhase === 'done' && (
          <TouchableOpacity
            style={[styles.actionBtn, isAAA && styles.actionBtnAAA]}
            onPress={handleRetry}>
            <Text style={[styles.actionBtnText, isAAA && styles.actionBtnTextAAA]}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.backBtn, isAAA && styles.backBtnAAA]}
          onPress={() => navigation.goBack()}>
          <Text style={[styles.backBtnText, isAAA && styles.backBtnTextAAA]}>
            {t('common.back')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Debug bar */}
      <View style={styles.debugBar}>
        <Text style={styles.debugText}>
          {verifyPhase.toUpperCase()}
          {fps > 0 ? ` | ${fps} FPS` : ''}
          {pipelineResult?.match
            ? ` | ${pipelineResult.match.name} (${pipelineResult.match.score.toFixed(2)})`
            : ` | DB: ${templateCount}`}
          {spoofResult ? ` | PAD: ${spoofResult.score.toFixed(2)}` : ''}
          {pipelineResult?.bioHashDistance !== undefined
            ? ` | BH: ${pipelineResult.bioHashDistance.toFixed(3)}`
            : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  message: {
    color: '#F8FAFC',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  permissionBtn: {
    marginTop: 24,
    alignSelf: 'center',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  guideOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 270,
    height: 350,
    borderRadius: 135,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
  },
  faceGuideAAA: {borderWidth: 5, borderColor: '#FFD700'},
  faceGuideMatch: {borderColor: '#10B981', borderStyle: 'solid', borderWidth: 5},
  faceGuideReject: {borderColor: '#EF4444', borderStyle: 'solid', borderWidth: 5},
  startOverlay: {
    position: 'absolute',
    bottom: 140,
    left: 20, right: 20,
    alignItems: 'center',
  },
  instructionPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  instruction: {
    color: '#F8FAFC',
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '500',
  },
  instructionAAA: {fontSize: 22, color: '#FFD700', fontWeight: '700'},
  startBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 48,
    paddingVertical: 18,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#3B82F6',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  startBtnAAA: {
    backgroundColor: '#FFD700',
    paddingVertical: 22,
  },
  startBtnText: {color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5},
  startBtnTextAAA: {color: '#000', fontSize: 24},
  faceLostBanner: {
    position: 'absolute',
    top: 110,
    left: 20, right: 20,
    backgroundColor: '#F59E0B',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
  },
  faceLostText: {color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center'},
  faceLostTextAAA: {fontSize: 20, color: '#000'},
  spoofBanner: {
    position: 'absolute',
    top: 110,
    left: 20, right: 20,
    backgroundColor: '#EF4444',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#EF4444',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  spoofText: {color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center'},
  spoofTextAAA: {fontSize: 24, color: '#FFD700'},
  bottomBar: {
    position: 'absolute',
    bottom: 30,
    left: 20, right: 20,
    gap: 10,
  },
  actionBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  actionBtnAAA: {backgroundColor: '#FFD700', paddingVertical: 20, borderRadius: 18},
  actionBtnText: {color: '#fff', fontSize: 17, fontWeight: '700'},
  actionBtnTextAAA: {color: '#000', fontSize: 22, fontWeight: '800'},
  backBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnAAA: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingVertical: 18,
    borderRadius: 18,
    borderColor: '#FFD700',
  },
  backBtnText: {color: '#F8FAFC', fontSize: 15, fontWeight: '600'},
  backBtnTextAAA: {color: '#FFD700', fontSize: 20, fontWeight: '700'},
  debugBar: {
    position: 'absolute',
    top: 48,
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
    letterSpacing: 0.3,
  },
});
