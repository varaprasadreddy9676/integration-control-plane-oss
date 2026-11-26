import { typography } from '../tokens/typography';
import { spacingToNumber } from './spacing';

export const editorFontSize = (type: 'body' | 'control') =>
  spacingToNumber(type === 'body' ? typography.fontSize.sm : typography.fontSize.base);
