import { useEffect, useRef } from 'react';

/**
 * Warns before the browser discards unsaved form edits.
 *
 * The integration, inbound and scheduled-job editors are long forms — people
 * spend real time in them, and until now a refresh, a closed tab or a click on
 * an external link threw all of it away without a word. The in-form Cancel
 * button already confirms; this covers the exits that leave the page entirely.
 *
 * Pass a PREDICATE rather than a boolean wherever the answer can change without
 * this hook re-rendering. A flag set from onValuesChange looks equivalent but
 * is not: these forms have panels that write back into the form during normal
 * rendering, so the flag latches on and never clears, and the prompt then fires
 * on every exit — including right after the user discarded or saved. A warning
 * that cries wolf gets dismissed reflexively, which is worse than no warning.
 * Asking `form.isFieldsTouched()` at the moment of unload always tells the
 * truth, and matches what the Cancel button already checks.
 *
 * Only the browser-level exit is covered. In-app navigation (the sidebar, a
 * breadcrumb) cannot be blocked with the plain <BrowserRouter> this app uses —
 * React Router's useBlocker needs a data router (createBrowserRouter). Guarding
 * those too means migrating the router, which is a separate piece of work.
 *
 * @param hasUnsavedChanges a boolean, or a predicate evaluated when the browser
 *                          is about to unload the page.
 */
export const useUnsavedChangesWarning = (hasUnsavedChanges: boolean | (() => boolean)): void => {
  // Kept in a ref so the listener always sees the current answer without being
  // torn down and re-registered on every render.
  const isDirtyRef = useRef(hasUnsavedChanges);
  isDirtyRef.current = hasUnsavedChanges;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const current = isDirtyRef.current;
      const isDirty = typeof current === 'function' ? current() : current;
      if (!isDirty) return;

      // Browsers show their own wording and ignore custom text; both the
      // preventDefault and the legacy returnValue are needed for full support.
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
};
