import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionTransformPreview } from '../features/integrations/components/detail/ActionTransformPreview';
import { TransformationSection } from '../features/integrations/components/TransformationSection';

vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: () => <textarea aria-label="JavaScript transform editor" />,
}));

vi.mock('../design-system/utils', () => ({
  cssVar: {
    table: { codeBg: 'var(--color-code-bg)' },
    text: { primary: 'var(--color-text-primary)' },
    legacy: {
      info: { 500: '#3b82f6' },
      primary: { 500: '#3b82f6', 600: '#2563eb' },
      neutral: { 50: 'var(--color-bg-base)', 100: 'var(--color-bg-subtle)', 900: 'var(--color-text-primary)' },
    },
  },
  useDesignTokens: () => ({
    spacing: new Proxy({}, { get: () => '8px' }),
    token: { borderRadius: 4, borderRadiusLG: 8 },
  }),
  spacingToNumber: (value: string | number) => Number.parseInt(String(value), 10) || 0,
}));

describe('transformation code panels', () => {
  it('uses semantic code colors and responsive layout for the main transform preview', () => {
    render(
      <App>
        <TransformationSection
          scriptValue="return payload;"
          onScriptChange={vi.fn()}
          sampleInput="{}"
          onSampleInputChange={vi.fn()}
          sampleOutput="{}"
          onSampleOutputChange={vi.fn()}
          getPreviewContext={() => ({ eventType: 'TEST_EVENT' })}
        />
      </App>
    );

    const sampleInput = screen.getByPlaceholderText('{"orderId": 12345}');
    expect(sampleInput).toHaveClass('transformation-code-textarea');
    expect(sampleInput.closest('.transformation-input-output-grid')).toBeInTheDocument();
  });

  it('uses semantic code colors in the multi-action transformation preview', () => {
    const { container } = render(
      <App>
        <ActionTransformPreview
          actionIndex={0}
          form={{ getFieldValue: () => undefined } as any}
          selectedEventTypeData={null}
          spacing={{ 1: '4px', 3: '12px' }}
          token={{}}
        />
      </App>
    );

    fireEvent.click(screen.getByText('Test Transformation'));
    const sampleInput = screen.getByPlaceholderText('{"orderId": 12345}');
    expect(sampleInput).toHaveStyle({
      background: 'var(--color-code-bg)',
      color: 'var(--color-text-primary)',
    });
    expect(sampleInput.closest('.action-transform-preview-grid')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-typography')).toHaveLength(0);
  });
});
