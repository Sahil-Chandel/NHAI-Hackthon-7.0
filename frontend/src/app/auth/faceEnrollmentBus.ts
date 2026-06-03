import {create} from 'zustand';
import type {EnrolledRole} from '../../ml/pipeline';

/**
 * Tiny in-memory bus used to hand off a freshly enrolled face's template_id
 * — OR a structured error — from the EnrollmentScreen back to the screen
 * that requested face capture (Admin signup, Add Worker). The originating
 * screen polls on focus and consumes either pending or error.
 */

export type EnrollmentPurpose =
  | 'admin_signup'
  | 'add_worker'
  | 'worker_onboard'
  | 'standalone';

export type EnrollmentErrorCode = 'duplicate_face' | 'capture_failed';

export type EnrollmentError = {
  purpose: EnrollmentPurpose;
  code: EnrollmentErrorCode;
  /** Existing record's role — only set for duplicate_face. */
  existingRole?: EnrolledRole;
  existingName?: string;
  /** Raw message for diagnostics / fallback display. */
  message?: string;
};

type Pending = {
  purpose: EnrollmentPurpose;
  templateId: string;
  userId: string;
  name: string;
};

type State = {
  pending: Pending | null;
  error: EnrollmentError | null;
  setPending: (
    purpose: EnrollmentPurpose,
    templateId: string,
    userId: string,
    name: string,
  ) => void;
  setError: (err: EnrollmentError) => void;
  /**
   * Consume both pending and error for the given purpose, returning whichever
   * is set. Returns `null` if neither matches. Clears whatever was returned.
   */
  consume: (
    purpose: EnrollmentPurpose,
  ) =>
    | {kind: 'success'; templateId: string; userId: string; name: string}
    | {kind: 'error'; error: EnrollmentError}
    | null;
  clear: () => void;
};

export const useFaceEnrollmentBus = create<State>((set, get) => ({
  pending: null,
  error: null,
  setPending: (purpose, templateId, userId, name) =>
    set({pending: {purpose, templateId, userId, name}, error: null}),
  setError: err => set({error: err, pending: null}),
  consume: purpose => {
    const {pending, error} = get();
    if (error && error.purpose === purpose) {
      set({error: null});
      return {kind: 'error', error};
    }
    if (pending && pending.purpose === purpose) {
      set({pending: null});
      return {
        kind: 'success',
        templateId: pending.templateId,
        userId: pending.userId,
        name: pending.name,
      };
    }
    return null;
  },
  clear: () => set({pending: null, error: null}),
}));
