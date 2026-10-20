import { flushSync } from 'react-dom';

type DocumentWithViewTransitions = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => {
    ready: Promise<void>;
    finished: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

/** Matches `.vt-entity-title` in motion.css: the detail page's title. */
const MORPH_NAME = 'entity-title';

let morphSource: HTMLElement | null = null;

/**
 * Marks the element the next navigation should morph from (for example the
 * integration name the user clicked), so it flies into the detail page title.
 */
export function markMorphSource(element: HTMLElement | null): void {
  morphSource = element;
}

/** Longest the old page is held while the new one renders. */
const ARRIVAL_TIMEOUT_MS = 300;

function waitUntil(ready: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (ready()) return resolve();
    const observer = new MutationObserver(() => {
      if (ready()) done();
    });
    const timer = window.setTimeout(done, timeoutMs);
    function done() {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve();
    }
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Runs a DOM-changing update (a route change) inside a View Transition, so the
 * old page fades out while the new one arrives. Falls back to a plain update
 * where the API is missing or the user asked for reduced motion.
 */
export function withViewTransition(update: () => void): void {
  const source = morphSource;
  morphSource = null;

  const doc = document as DocumentWithViewTransitions;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }

  if (source) source.style.viewTransitionName = MORPH_NAME;
  const transition = doc.startViewTransition(async () => {
    if (source) source.style.viewTransitionName = '';
    flushSync(update);
    // Lazy routes render a loading state first. Hold the old frame briefly so
    // the transition lands on the new page (and its title) rather than a spinner.
    await waitUntil(
      () => !document.querySelector('[data-route-loading]') && (!source || !!document.querySelector('.vt-entity-title')),
      ARRIVAL_TIMEOUT_MS
    );
  });
  // A skipped transition (tab hidden, duplicate names) is not an error for the
  // user: the navigation itself has already happened.
  const ignore = () => undefined;
  transition.ready.catch(ignore);
  transition.finished.catch(ignore);
  transition.updateCallbackDone.catch(ignore);
}
