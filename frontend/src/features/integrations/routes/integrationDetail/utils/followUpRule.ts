export const getPrimaryEventType = (eventTypes?: string[] | string | null): string | undefined => {
  if (typeof eventTypes === 'string') {
    const trimmed = eventTypes.trim();
    return trimmed || undefined;
  }

  if (!Array.isArray(eventTypes)) {
    return undefined;
  }

  return eventTypes.find((value) => typeof value === 'string' && value.trim() !== '')?.trim();
};

export const toSingleEventTypeList = (eventType?: string | null): string[] => {
  if (typeof eventType !== 'string') {
    return [];
  }

  const trimmed = eventType.trim();
  return trimmed ? [trimmed] : [];
};
