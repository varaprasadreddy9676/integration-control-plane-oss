/**
 * How a follow-up status is shown. The status word is whatever the integration's
 * script returned (DELIVERED, READ, SIGNED_OFF...), so it is shown as written, in
 * plain words; only the gateway's own PENDING, UNKNOWN and NOT_TRACKED get fixed text.
 */

const OWN_LABEL: Record<string, string> = {
  PENDING: 'Checking',
  UNKNOWN: 'Unknown',
  NOT_TRACKED: 'Not tracked',
};

/** READ -> "Read", SIGNED_OFF -> "Signed off". */
export const followUpStatusLabel = (status?: string | null): string => {
  if (!status) return 'Checking';
  if (OWN_LABEL[status]) return OWN_LABEL[status];
  const words = status.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const BAD = /FAIL|ERROR|REJECT|UNDELIVER|BOUNCE|DENIED|CANCEL/;

/** Red for anything failed, green once it is done well, blue while in progress. */
export const followUpStatusColor = (status?: string | null, done?: boolean): string => {
  if (!status || status === 'PENDING' || status === 'NOT_TRACKED') return 'default';
  if (status === 'UNKNOWN') return 'orange';
  if (BAD.test(status)) return 'red';
  return done || status === 'DELIVERED' || status === 'READ' ? 'green' : 'blue';
};
