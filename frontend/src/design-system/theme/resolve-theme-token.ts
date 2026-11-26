export type ThemeTokenValue = string | [string, string] | undefined;

export const resolveThemeToken = (value: ThemeTokenValue, mode: 'light' | 'dark') => {
  if (Array.isArray(value)) return value[mode === 'light' ? 0 : 1];
  if (!value) return undefined;

  const lightDarkValue = /^light-dark\((#[\da-f]{3,8}),\s*(#[\da-f]{3,8})\)$/i.exec(value);
  if (lightDarkValue) return lightDarkValue[mode === 'light' ? 1 : 2];

  return value;
};
