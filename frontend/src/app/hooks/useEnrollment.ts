import {useState, useCallback, useRef, useMemo} from 'react';
import {enrollFace, DuplicateFaceError, type EnrolledRole} from '../../ml/pipeline';

export type EnrollStep = 'idle' | 'frontal' | 'left' | 'right' | 'processing' | 'done' | 'error';

export type DuplicateInfo = {
  existingRole: EnrolledRole;
  existingName: string;
};

const STEPS: EnrollStep[] = ['frontal', 'left', 'right'];
const STEP_LABELS = {
  frontal: 'enroll.step_frontal',
  left: 'enroll.step_left',
  right: 'enroll.step_right',
};

export function useEnrollment() {
  const [step, setStep] = useState<EnrollStep>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enrolledId, setEnrolledId] = useState<string | null>(null);
  // Real enrollment metrics surfaced to the post-onboarding result screen:
  // `confidence` = mean cosine similarity of the captured pose embeddings to
  // the final template (a genuine self-consistency score, not a fixed number),
  // `elapsedMs` = on-device time to build + persist the template.
  const [metrics, setMetrics] = useState<{confidence: number; elapsedMs: number} | null>(null);
  // When the failure is a known DuplicateFaceError, we surface structured info
  // so the originating screen (admin signup / add worker) can render a
  // role-aware message ("you are already a worker") instead of a raw string.
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);

  const embeddings = useRef<number[][]>([]);
  const stepIndexRef = useRef(0);
  const processingRef = useRef(false);
  const userIdRef = useRef('');
  const nameRef = useRef('');
  const skipDupRef = useRef(false);

  const startEnrollment = useCallback(
    (id: string, userName: string, skipDuplicateCheck = false) => {
    setUserId(id);
    setName(userName);
    userIdRef.current = id;
    nameRef.current = userName;
    skipDupRef.current = skipDuplicateCheck;
    setStepIndex(0);
    stepIndexRef.current = 0;
    setStep('frontal');
    setError(null);
    setEnrolledId(null);
    setDuplicate(null);
    setMetrics(null);
    embeddings.current = [];
    processingRef.current = false;
  }, []);

  const captureEmbedding = useCallback(
    (embedding: number[]) => {
      if (processingRef.current) return;

      embeddings.current.push(embedding);

      const nextIdx = stepIndexRef.current + 1;
      if (nextIdx < STEPS.length) {
        stepIndexRef.current = nextIdx;
        setStepIndex(nextIdx);
        setStep(STEPS[nextIdx]);
      } else {
        processingRef.current = true;
        setStep('processing');

        try {
          const t0 = Date.now();
          const dim = embedding.length;
          const mean = new Array(dim).fill(0);
          for (const emb of embeddings.current) {
            for (let i = 0; i < dim; i++) {
              mean[i] += emb[i];
            }
          }
          let norm = 0;
          for (let i = 0; i < dim; i++) {
            mean[i] /= embeddings.current.length;
            norm += mean[i] * mean[i];
          }
          norm = Math.sqrt(norm);
          if (norm > 1e-8) {
            for (let i = 0; i < dim; i++) {
              mean[i] /= norm;
            }
          }

          // Self-consistency: each captured pose embedding is unit-length, so
          // its dot product with the unit template == cosine similarity.
          let cosSum = 0;
          for (const emb of embeddings.current) {
            let d = 0;
            for (let i = 0; i < dim; i++) d += emb[i] * mean[i];
            cosSum += d;
          }
          // Guard the degenerate mean (norm ~ 0 → template wasn't normalized) and
          // clamp float drift so the displayed score is always a sane [0,1].
          const confidence =
            norm > 1e-8 && embeddings.current.length
              ? Math.max(0, Math.min(1, cosSum / embeddings.current.length))
              : 0;

          const result = enrollFace(userIdRef.current, nameRef.current, mean, skipDupRef.current);
          setMetrics({confidence, elapsedMs: Date.now() - t0});
          setEnrolledId(result.id);
          setStep('done');
        } catch (e: any) {
          setError(e?.message ?? 'Enrollment failed');
          if (e instanceof DuplicateFaceError) {
            setDuplicate({
              existingRole: e.existingRole,
              existingName: e.existingName,
            });
          }
          setStep('error');
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setStepIndex(0);
    stepIndexRef.current = 0;
    setUserId('');
    setName('');
    userIdRef.current = '';
    nameRef.current = '';
    setError(null);
    setEnrolledId(null);
    setDuplicate(null);
    setMetrics(null);
    embeddings.current = [];
    processingRef.current = false;
  }, []);

  // Memoised so the returned object keeps a STABLE identity across renders.
  // Consumers (EnrollmentScreen) put `enrollment` in effect dependency arrays;
  // a fresh literal every render made those effects tear down + re-run on every
  // render, which could cancel an in-flight navigation timer. The callbacks are
  // already stable (useState setters / useCallback []), so identity only changes
  // when the exposed state actually changes.
  return useMemo(
    () => ({
      step,
      stepIndex,
      totalSteps: STEPS.length,
      stepLabel: STEP_LABELS[step as keyof typeof STEP_LABELS] ?? '',
      userId,
      name,
      error,
      duplicate,
      enrolledId,
      metrics,
      setUserId,
      setName,
      startEnrollment,
      captureEmbedding,
      reset,
    }),
    [
      step,
      stepIndex,
      userId,
      name,
      error,
      duplicate,
      enrolledId,
      metrics,
      startEnrollment,
      captureEmbedding,
      reset,
    ],
  );
}
