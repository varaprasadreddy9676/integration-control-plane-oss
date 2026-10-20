'use strict';

/** Human-readable duration for an alert subject line, e.g. "45 minutes", "3 hours", "2 days". */
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 120) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
}

module.exports = { formatDuration };
