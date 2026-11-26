import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import type { FlowExecutionResult } from '../features/flowBuilder/state/flowTypes';
import FlowRunPanel from '../features/flowBuilder/components/FlowRunPanel';

describe('FlowRunPanel status presentation', () => {
  it('shows sentence-case run and step states without AntD status tags', () => {
    const result: FlowExecutionResult = {
      success: false,
      executionTime: 245,
      steps: [
        { nodeId: 'trigger-1', nodeType: 'trigger', status: 'success', durationMs: 20 },
        { nodeId: 'transform-1', nodeType: 'transform', status: 'failed', durationMs: 210, error: 'Invalid output' },
        { nodeId: 'response-1', nodeType: 'response', status: 'skipped', durationMs: 15 },
      ],
      error: { message: 'The transform step failed', nodeId: 'transform-1' },
    };
    render(
      <ThemeProvider>
        <FlowRunPanel visible executionResult={result} onClose={vi.fn()} />
      </ThemeProvider>
    );

    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText('Invalid output')).toBeInTheDocument();
    expect(document.body.querySelectorAll('.status-badge')).toHaveLength(4);
    expect(document.body.querySelector('.astryx-banner')).toHaveTextContent('Execution Error');
    expect(document.body.querySelector('.ant-tag')).not.toBeInTheDocument();
    expect(document.body.querySelector('.ant-alert')).not.toBeInTheDocument();
  });

  it('uses a neutral empty state before a test has run', () => {
    render(
      <ThemeProvider>
        <FlowRunPanel visible executionResult={null} onClose={vi.fn()} />
      </ThemeProvider>
    );

    expect(screen.getByText('No test results')).toBeInTheDocument();
  });
});
