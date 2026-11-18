import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stageMenu } from '../features/stages/components/delivery-tab/stageLibrary';
import type { StageRunner, StageTemplate } from '../services/stages-api';

const runner = (type: string, label: string, description: string | undefined, hooks: StageRunner['hooks']): StageRunner => ({
  type,
  label,
  description,
  hooks,
  configSchema: { fields: [] },
  presentation: { icon: type === 'http' ? 'http' : 'script' },
});

const library = {
  runners: [
    runner('script', 'Script', 'A few lines of code', ['before_send']),
    runner('http', 'HTTP request', 'Call another service', ['before_send', 'after_delivery']),
    runner('url-check', 'Check linked URLs', undefined, ['after_delivery']),
  ],
  templates: [
    { id: 't1', label: 'Skip people who opted out', description: 'Stops the send when there is no consent', provider: 'any', hook: 'before_send', recommended: true } as StageTemplate,
  ],
};

describe('the add-a-step menu', () => {
  it('says what each choice is for, not just its name', () => {
    const { items } = stageMenu('before_send', library, { onRunner: vi.fn(), onTemplate: vi.fn() });
    render(<div>{items.flatMap((item: any) => (item.children ? item.children : [item])).map((item: any) => item.label && <div key={item.key}>{item.label}</div>)}</div>);
    expect(screen.getByText('Script')).toBeInTheDocument();
    expect(screen.getByText('A few lines of code')).toBeInTheDocument();
    expect(screen.getByText('Call another service')).toBeInTheDocument();
    expect(screen.getByText(/Skip people who opted out/)).toBeInTheDocument();
    expect(screen.getByText('Stops the send when there is no consent')).toBeInTheDocument();
    expect(screen.queryByText('Check linked URLs')).not.toBeInTheDocument();
  });

  it('still hands the chosen runner or template to the caller', () => {
    const onRunner = vi.fn();
    const onTemplate = vi.fn();
    const menu = stageMenu('before_send', library, { onRunner, onTemplate });
    menu.onClick({ key: 'runner:http' });
    menu.onClick({ key: 'template:t1' });
    expect(onRunner).toHaveBeenCalledWith('http');
    expect(onTemplate).toHaveBeenCalledWith('t1');
  });
});
