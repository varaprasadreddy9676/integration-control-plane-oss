import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACTIVITY_EVENTS } from '../services/activity-tracker';

/**
 * The cURL preview masks credentials by default and lets an admin reveal them
 * so the command actually runs. That reveal is a deliberate exception which
 * puts a working secret on screen and on the clipboard, so it has to leave a
 * record — otherwise "who saw this credential, and when" is unanswerable.
 *
 * Two properties matter and are easy to lose in a refactor:
 *   1. Only *revealing* is recorded. Hiding again is not a security event, and
 *      logging both would make the audit trail noisy enough to ignore.
 *   2. The event is flushed immediately. The tracker batches by default, and an
 *      audit record that a closed tab can discard is not an audit record.
 */
const makeToggle = (tracker: { track: (p: unknown) => void; flush: () => void }) => {
  let revealed = false;
  return {
    get revealed() {
      return revealed;
    },
    toggle() {
      const nowRevealed = !revealed;
      if (nowRevealed) {
        tracker.track({ event: ACTIVITY_EVENTS.CREDENTIAL_REVEALED, metadata: { surface: 'delivery-log-curl' } });
        tracker.flush();
      }
      revealed = nowRevealed;
    },
  };
};

describe('credential reveal is audited', () => {
  let tracker: { track: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tracker = { track: vi.fn(), flush: vi.fn() };
  });

  it('records an event when credentials are revealed', () => {
    const toggle = makeToggle(tracker);
    toggle.toggle();

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'credential_revealed' })
    );
  });

  it('flushes immediately rather than leaving it in the batch queue', () => {
    const toggle = makeToggle(tracker);
    toggle.toggle();

    expect(tracker.flush).toHaveBeenCalledTimes(1);
  });

  it('does not record an event for hiding them again', () => {
    const toggle = makeToggle(tracker);
    toggle.toggle();
    toggle.toggle();

    expect(toggle.revealed).toBe(false);
    expect(tracker.track).toHaveBeenCalledTimes(1);
  });

  it('exposes the event name as a shared constant, not a loose string', () => {
    expect(ACTIVITY_EVENTS.CREDENTIAL_REVEALED).toBe('credential_revealed');
  });
});
