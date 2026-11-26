import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LogCodeViewer } from '../features/logs/components/LogCodeViewer';

describe('LogCodeViewer', () => {
  it('keeps copyable command text readable with line numbers and shell token styling', () => {
    const command = ['curl -X POST \\', '  "https://example.test/api"'].join('\n');
    render(<LogCodeViewer value={command} language="shell" label="cURL command" />);

    const viewer = screen.getByLabelText('cURL command');
    expect(viewer).toHaveTextContent('curl -X POST');
    expect(viewer).toHaveTextContent('https://example.test/api');
    expect(viewer.querySelectorAll('.log-code-viewer__number')).toHaveLength(2);
    expect(viewer.querySelector('.log-code-viewer__token--command')).toHaveTextContent('curl');
    expect(viewer.querySelector('.log-code-viewer__token--flag')).toHaveTextContent('-X');
  });

  it('renders empty content when the server has no body for this response', () => {
    render(<LogCodeViewer value={null} label="Response body" />);
    expect(screen.getByRole('status', { name: 'Response body' })).toHaveTextContent('No content was recorded');
  });
});
