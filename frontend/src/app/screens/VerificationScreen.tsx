import React, {useEffect, useState, useCallback} from 'react';
import {StyleSheet, Text, View, TouchableOpacity} from 'react-native';
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

import {postProcessYuNet} from '../../ml/processors/faceDetect.worklet';
import {extractEmbedding} from '../../ml/processors/faceEmbed.worklet';
import {runAntiSpoof} from '../../ml/processors/antiSpoof.worklet';
import {THRESHOLDS} from '../../ml/thresholds';
import {useFaceAuth} from '../hooks/useFaceAuth';
import {useLiveness} from '../hooks/useLiveness';
import {useVoicePrompt} from '../components/VoicePrompt';
import AuthResultBanner from '../components/AuthResultBanner';
import LivenessChallengeOverlay from '../components/LivenessChallengeOverlay';
import {useThemeContext} from '../theme/ThemeContext';
import type {FaceData} from '../../ml/challenges/challengeEngine';

type VerifyPhase = 'idle' | 'liveness' | 'verifying' | 'done';

const YUNET_INPUT = 640;
const CONFIDENCE_MIN = THRESHOLDS.DETECTION_CONFIDENCE;

export default function VerificationScreen() {
  const {t} = useTranslation();
  const navigation = useNavigation();
  const {isAAA} = useThemeContext();
  const {hasPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const {speak} = useVoicePrompt();

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
    minFaceSize: 0.2,
  });

  const yunet = useTensorflowModel(
    require('../../../assets/models/yunet_int8.tflite'),
  );
  const edgeface = useTensorflowModel(
    require('../../../assets/models/edgeface_xs_int8.tflite'),
  );
  const antiSpoofV2 = useTensorflowModel(
    require('../../../assets/models/minifasnet_v2.tflite'),
  );
  const antiSpoofV1SE = useTensorflowModel(
    require('../../../assets/models/minifasnet_v1se.tflite'),
  );

  const yunetModel = yunet.state === 'loaded' ? yunet.model : undefined;
  const edgefaceModel = edgeface.state === 'loaded' ? edgeface.model : undefined;
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
      // Anti-spoof will run on next frame in the frame processor
      setVerifyPhase('verifying');
      verifyPhaseShared.value = 'verifying';
    } else if (liveness.phase === 'failed' && verifyPhase === 'liveness') {
      speak(t('liveness.failed'), true);
      setVerifyPhase('done');
      verifyPhaseShared.value = 'done';
    }
  }, [liveness.phase, verifyPhase, speak, t]);

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

        // Run face recognition
        if (!yunetModel) return;
        const start = performance.now();
        try {
          const out = yunetModel.runSync([frame as any]);
          if (out && out.length >= 4) {
            const dets = postProcessYuNet(
              out as unknown as ArrayBuffer[],
              YUNET_INPUT,
              YUNET_INPUT,
              frame.width,
              frame.height,
            );
            const latency = performance.now() - start;
            if (dets.length > 0) {
              let emb = null;
              if (edgefaceModel && dets[0].confidence > CONFIDENCE_MIN) {
                emb = extractEmbedding(edgefaceModel, frame);
              }
              onFrameResultJS(dets[0], emb, latency);
            } else {
              onFrameResultJS(null, null, latency);
            }
          }
        } catch {}
      }
    },
    [
      verifyPhaseShared,
      spoofCheckedShared,
      yunetModel,
      edgefaceModel,
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
    }
  }, [pipelineResult?.stage, pipelineResult?.match?.name, speak, t, verifyPhase]);

  if (!device || !hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t('common.loading')}</Text>
      </View>
    );
  }

  const modelsLoading =
    yunet.state === 'loading' ||
    edgeface.state === 'loading' ||
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
            <Text style={[styles.instruction, isAAA && styles.instructionAAA]}>
              {t('common.loading')}
            </Text>
          ) : (
            <>
              <Text style={[styles.instruction, isAAA && styles.instructionAAA]}>
                {t('verify.position_face')}
              </Text>
              <TouchableOpacity
                style={[styles.startBtn, isAAA && styles.startBtnAAA]}
                onPress={handleStartLiveness}>
                <Text style={[styles.startBtnText, isAAA && styles.startBtnTextAAA]}>
                  {t('liveness.start')}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Liveness phase — challenge overlay */}
      {verifyPhase === 'liveness' && (
        <LivenessChallengeOverlay
          phase={liveness.phase}
          currentStep={liveness.currentStep}
          stepIndex={liveness.stepIndex}
          totalSteps={liveness.totalSteps}
        />
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
          {detection ? ` | ${detection.confidence.toFixed(2)}` : ''}
          {spoofResult ? ` | PAD: ${spoofResult.score.toFixed(2)}` : ''}
          {` | DB: ${templateCount}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  guideOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 260,
    height: 340,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },
  faceGuideAAA: {
    borderWidth: 4,
    borderColor: '#ffdd00',
  },
  faceGuideMatch: {
    borderColor: '#00cc66',
    borderStyle: 'solid',
  },
  faceGuideReject: {
    borderColor: '#ff4444',
    borderStyle: 'solid',
  },
  startOverlay: {
    position: 'absolute',
    bottom: 160,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  instruction: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
    opacity: 0.7,
    textAlign: 'center',
  },
  instructionAAA: {
    fontSize: 22,
    opacity: 1,
    color: '#ffdd00',
  },
  startBtn: {
    backgroundColor: '#0096ff',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 14,
  },
  startBtnAAA: {
    backgroundColor: '#ffdd00',
    paddingVertical: 20,
    borderRadius: 18,
  },
  startBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  startBtnTextAAA: {
    color: '#000',
    fontSize: 24,
    fontWeight: '800',
  },
  spoofBanner: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,68,68,0.9)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  spoofText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  spoofTextAAA: {
    fontSize: 24,
    color: '#ffdd00',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    gap: 12,
  },
  actionBtn: {
    backgroundColor: '#0096ff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnAAA: {
    backgroundColor: '#ffdd00',
    paddingVertical: 18,
    borderRadius: 16,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  actionBtnTextAAA: {
    color: '#000',
    fontSize: 22,
    fontWeight: '700',
  },
  backBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  backBtnAAA: {
    backgroundColor: 'rgba(255,221,0,0.3)',
    paddingVertical: 18,
    borderRadius: 16,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backBtnTextAAA: {
    color: '#ffdd00',
    fontSize: 22,
    fontWeight: '700',
  },
  debugBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  debugText: {
    color: '#0f0',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
