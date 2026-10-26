import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransformationPanelContent } from '../features/integrations/routes/integrationDetail/components/TransformationPanel';

vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ value }: { value?: string }) => <pre aria-label="Script">{value}</pre>,
}));

const spacing = new Proxy({}, { get: () => '8px' }) as Record<string, string>;
const base = {
  isCreate: false,
  isEditMode: false,
  selectedEventType: 'VISIT_COMPLETED',
  scriptValue: '',
  spacing,
  token: { borderRadius: 6, borderRadiusLG: 8 },
  colors: {},
  formatScriptForDisplay: (script?: string) => script || '',
};

describe('the Transformation tab', () => {
  it('edits in place: the editor is the tab, with no second screen to open', () => {
    render(<TransformationPanelContent {...base} isEditMode editor={<div>script editor</div>} />);
    expect(screen.getByText('script editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Configure Transformation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Preview$/ })).not.toBeInTheDocument();
  });

  it('shows the script when only viewing, or says the event is sent as it is', () => {
    const { rerender } = render(<TransformationPanelContent {...base} scriptValue="return payload;" editor={<div>script editor</div>} />);
    expect(screen.getByLabelText('Script')).toHaveTextContent('return payload;');
    expect(screen.queryByText('script editor')).not.toBeInTheDocument();
    rerender(<TransformationPanelContent {...base} editor={<div>script editor</div>} />);
    expect(screen.getByText(/the event is sent as it is/)).toBeInTheDocument();
  });

  it('asks for an event type first, because the editor previews with that event', () => {
    render(<TransformationPanelContent {...base} isEditMode selectedEventType={undefined} editor={<div>script editor</div>} />);
    expect(screen.getByText('Select an event type first')).toBeInTheDocument();
    expect(screen.queryByText('script editor')).not.toBeInTheDocument();
  });
});
