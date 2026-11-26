import type { ReactNode } from 'react';

type LogCodeLanguage = 'shell' | 'json' | 'text';

interface LogCodeViewerProps {
  value: string | null | undefined;
  language?: LogCodeLanguage;
  label: string;
}

function highlightLine(line: string, language: LogCodeLanguage): ReactNode[] {
  if (language === 'text') return [line || ' '];

  const tokens =
    language === 'shell'
      ? /(\bcurl\b|-{1,2}[A-Za-z][\w-]*|https?:\/\/[^\s'"\\]+|'[^']*'|"[^"]*")/g
      : /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b)/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(line))) {
    if (match.index > cursor) result.push(line.slice(cursor, match.index));
    const token = match[0];
    const kind =
      language === 'shell'
        ? token === 'curl'
          ? 'command'
          : token.startsWith('-')
            ? 'flag'
            : 'string'
        : /^['"]/.test(token)
          ? 'string'
          : /^(true|false|null)$/.test(token)
            ? 'literal'
            : 'number';
    result.push(
      <span className={`log-code-viewer__token log-code-viewer__token--${kind}`} key={`${match.index}-${token}`}>
        {token}
      </span>
    );
    cursor = match.index + token.length;
  }
  if (cursor < line.length) result.push(line.slice(cursor));
  return result.length ? result : [' '];
}

export function LogCodeViewer({ value, language = 'text', label }: LogCodeViewerProps) {
  const normalizedValue = value ?? '';
  if (!normalizedValue.trim()) {
    const emptyMessage =
      language === 'shell'
        ? 'Command unavailable: request details were not recorded.'
        : language === 'json'
          ? 'No response body was recorded.'
          : 'No content was recorded for this delivery.';
    return (
      <div className="log-code-viewer-empty" role="status" aria-label={label}>
        {emptyMessage}
      </div>
    );
  }

  const lines = normalizedValue.split('\n');
  return (
    <pre className="log-code-viewer" aria-label={label} tabIndex={0}>
      <code>
        {lines.map((line, index) => (
          <span className="log-code-viewer__line" key={index}>
            <span className="log-code-viewer__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="log-code-viewer__content">{highlightLine(line, language)}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}
