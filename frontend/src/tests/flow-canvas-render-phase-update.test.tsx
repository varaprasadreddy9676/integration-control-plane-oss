import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

let emitDuringRender = false;
let reactFlowProps: Record<string, any> | undefined;
vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>();
  return {
    ...actual,
    default: (props: any) => {
      reactFlowProps = props;
      if (emitDuringRender) {
        emitDuringRender = false;
        props.onNodesChange([{ id: 'trigger-1', type: 'position', position: { x: 12, y: 18 } }]);
      }
      return React.createElement('div', { 'data-testid': 'mock-flow' });
    },
  };
});

import FlowCanvas from '../features/flowBuilder/components/FlowCanvas';

describe('FlowCanvas render-phase changes', () => {
  afterEach(() => {
    emitDuringRender = false;
    reactFlowProps = undefined;
    vi.restoreAllMocks();
  });

  it('notifies the parent after commit instead of updating it during the canvas render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onNodesChange = vi.fn();
    emitDuringRender = true;

    const Parent = () => {
      const [, setNodes] = React.useState([]);
      return (
        <FlowCanvas
          nodes={[{ id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: {} } as any]}
          edges={[]}
          mode="INBOUND"
          onNodesChange={(nodes) => {
            onNodesChange(nodes);
            setNodes(nodes as any);
          }}
        />
      );
    };

    render(<Parent />);

    await waitFor(() => expect(onNodesChange).toHaveBeenCalledTimes(1));
    expect(onNodesChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'trigger-1', position: { x: 12, y: 18 } }),
    ]);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Cannot update a component')
    );
  });

  it('synchronizes keyboard-driven canvas selection with the editor inspector', () => {
    const onNodeSelect = vi.fn();
    render(
      <FlowCanvas
        nodes={[{ id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: {} } as any]}
        edges={[]}
        mode="INBOUND"
        onNodeSelect={onNodeSelect}
      />
    );

    reactFlowProps?.onSelectionChange({ nodes: [{ id: 'trigger-1' }], edges: [] });
    expect(onNodeSelect).toHaveBeenCalledWith('trigger-1');

    reactFlowProps?.onSelectionChange({ nodes: [], edges: [] });
    expect(onNodeSelect).toHaveBeenLastCalledWith(null);
  });
});
