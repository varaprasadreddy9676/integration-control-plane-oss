import { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { useDesignTokens, cssVar } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';

interface MonacoEditorInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
}

/**
 * Monaco Editor wrapper component for Form.Item compatibility
 * Provides JavaScript code editing with IntelliSense, bracket pairing, and syntax highlighting
 */
export const MonacoEditorInput = ({
  value,
  onChange,
  placeholder,
  height = '300px',
  readOnly = false,
}: MonacoEditorInputProps) => {
  const { token, typography } = useDesignTokens();
  const { mode } = useThemeMode();
  return (
    <div
      style={{
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        border: `1px solid ${cssVar.border.default}`,
        boxShadow: token.boxShadowSecondary,
        opacity: readOnly ? 0.9 : 1,
      }}
    >
      <Editor
        height={height}
        language="javascript"
        value={value || placeholder || ''}
        onChange={(newValue) => onChange?.(newValue ?? '')}
        options={{
          readOnly,
          // Display
          minimap: { enabled: false },
          fontSize: Number.parseFloat(typography.fontSize.base) * 16,
          // System monospace fonts only: Monaco measures a character's width once, and a web font that
          // arrives afterwards leaves the highlights and the wrapping out of line with the text.
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          lineNumbers: 'on',
          wordWrap: 'on',
          glyphMargin: true,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          renderLineHighlight: 'all',

          // Editing behavior
          tabSize: 2,
          insertSpaces: true,
          autoIndent: 'full',
          formatOnPaste: true,
          formatOnType: true,

          // IntelliSense & suggestions
          quickSuggestions: {
            other: true,
            comments: false,
            strings: true,
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnCommitCharacter: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          wordBasedSuggestions: 'currentDocument',
          suggest: {
            showKeywords: true,
            showSnippets: true,
            showFunctions: true,
            showVariables: true,
          },

          // Bracket matching & pairing
          matchBrackets: 'always',
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          autoSurround: 'languageDefined',
          bracketPairColorization: {
            enabled: true,
          },

          // Find/Replace
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: 'never',
            seedSearchStringFromSelection: 'always',
          },

          // Scrolling
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          mouseWheelZoom: true,

          // Context menu
          contextmenu: true,

          // Additional features
          parameterHints: {
            enabled: true,
          },
          hover: {
            enabled: 'on',
          },
          links: true,
          colorDecorators: true,
          comments: {
            insertSpace: true,
          },
        }}
        theme={mode === 'dark' ? 'vs-dark' : 'light'}
        onMount={(_editor, monaco) => {
          // Measure again once every font the page uses has settled.
          void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
        }}
      />
    </div>
  );
};
