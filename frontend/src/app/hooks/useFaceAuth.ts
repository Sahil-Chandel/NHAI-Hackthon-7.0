import {useState, useCallback, useRef} from 'react';
import {
  processEmbedding,
  initPipeline,
  reloadTemplates,
  type PipelineResult,
} from '../../ml/pipeline';
import type {FaceDetection} from '../../ml/processors/faceDetect.worklet';
import type {EmbeddingResult} from '../../ml/processors/faceEmbed.worklet';

export function useFaceAuth() {
  const [detection, setDetection] = useState<FaceDetection | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [fps, setFps] = useState(0);
  const [templateCount, setTemplateCount] = useState(0);

  const [hasFace, setHasFace] = useState(false);
  const latestEmbeddingRef = useRef<number[] | null>(null);
  // Engine that produced the latest embedding. Lets the enrollment screen
  // refuse to register a template built from the non-discriminative ML-Kit
  // fallback signature (which would match everyone).
  const latestSourceRef = useRef<'edgeface' | 'mlkit_fallback' | null>(null);

  const init = useCallback(() => {
    try {
      initPipeline();
      const count = reloadTemplates();
      setTemplateCount(count);
    } catch {}
  }, []);

  const onFrameResult = useCallback(
    (
      det: FaceDetection | null,
      embResult: EmbeddingResult | null,
      latency: number,
    ) => {
      setDetection(det);
      if (latency > 0) setFps(Math.round(1000 / latency));

      if (embResult && det) {
        latestEmbeddingRef.current = embResult.embedding;
        latestSourceRef.current = embResult.source ?? 'edgeface';
        setHasFace(true);
        const result = processEmbedding(
          embResult.embedding,
          embResult.magnitude,
          embResult.latencyMs,
          embResult.source ?? 'edgeface',
        );
        setPipelineResult(result);
      } else if (det) {
        latestEmbeddingRef.current = null;
        latestSourceRef.current = null;
        setHasFace(false);
      } else {
        latestEmbeddingRef.current = null;
        latestSourceRef.current = null;
        setHasFace(false);
        setPipelineResult({stage: 'no_face'});
      }
    },
    [],
  );

  const refreshTemplates = useCallback(() => {
    const count = reloadTemplates();
    setTemplateCount(count);
    return count;
  }, []);

  return {
    detection,
    pipelineResult,
    fps,
    templateCount,
    hasFace,
    latestEmbeddingRef,
    latestSourceRef,
    init,
    onFrameResult,
    refreshTemplates,
  };
}
