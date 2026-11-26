import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

const restrictedImportsRule = [
  'error',
  {
    paths: [
      {
        name: '@/design-system/tokens/colors',
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      },
      {
        name: '../design-system/tokens/colors',
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      }
    ],
    patterns: [
      {
        group: ['**/design-system/tokens/colors'],
        message: 'Do not import colors directly. Use cssVar.* or var(--color-*) instead.'
      }
    ]
  }
];

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['dist/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks
    },
    rules: {
      'no-restricted-imports': restrictedImportsRule,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['src/design-system/theme/**', 'src/design-system/utils/useThemeColors.ts'],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
];
