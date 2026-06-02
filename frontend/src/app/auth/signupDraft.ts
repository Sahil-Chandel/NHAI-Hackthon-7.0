import {create} from 'zustand';

/**
 * Module-level draft of an in-progress signup/add form. The form screens'
 * React component state (name/mobile/aadhar) does NOT reliably survive the
 * round-trip to the camera/Enroll screen — on return the screen can remount
 * (camera is memory-heavy; the OS may evict backgrounded screens) with empty
 * state. The face-enrollment bus survives that remount (it's module-level
 * zustand), so the focus-effect still fires and auto-submits. Without a
 * persisted draft it would submit BLANK fields → backend 422
 * "String should have at least…".
 *
 * We stash the (already-normalized) form values here when face capture starts
 * and read them back at submit time, so the data survives any remount. Keyed
 * by purpose so the admin-signup and add-worker flows don't clobber each other.
 */
export type FormDraft = {name: string; mobile?: string; aadhar: string};
export type DraftKey = 'admin_signup' | 'add_worker';

type State = {
  drafts: Partial<Record<DraftKey, FormDraft>>;
  setDraft: (key: DraftKey, d: FormDraft) => void;
  getDraft: (key: DraftKey) => FormDraft | undefined;
  clear: (key: DraftKey) => void;
};

export const useSignupDraft = create<State>((set, get) => ({
  drafts: {},
  setDraft: (key, d) => set(s => ({drafts: {...s.drafts, [key]: d}})),
  getDraft: key => get().drafts[key],
  clear: key =>
    set(s => {
      const next = {...s.drafts};
      delete next[key];
      return {drafts: next};
    }),
}));
