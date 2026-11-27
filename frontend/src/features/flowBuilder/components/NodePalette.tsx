/**
 * Node Palette Component
 *
 * Left sidebar showing available nodes that can be dragged onto the canvas
 */

import React from 'react';
import { Card, Space, Tooltip, Badge } from '@/components/common/LegacyAntdControls';
import { Heading } from '@astryxdesign/core/Heading';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { cssVar } from '../../../design-system/utils';
import type { IntegrationMode, FlowNodeType } from '../state/flowTypes';
import { ALLOWED_NODE_TYPES } from '../state/flowSchema';

interface NodePaletteItem {
  type: FlowNodeType;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: 'trigger' | 'logic' | 'action' | 'output';
  allowedModes: IntegrationMode[];
  color: string;
}

const NODE_PALETTE_ITEMS: NodePaletteItem[] = [
  {
    type: 'trigger',
    label: 'Trigger',
    description: 'Start point for the integration',
    icon: <GatewayIcon name="ThunderboltOutlined" />,
    category: 'trigger',
    allowedModes: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'inboundAuth',
    label: 'Inbound Auth',
    description: 'Validate incoming API requests',
    icon: <GatewayIcon name="LockOutlined" />,
    category: 'logic',
    allowedModes: ['INBOUND'],
    color: cssVar.text.secondary,
  },
  {
    type: 'outboundAuth',
    label: 'Outbound Auth',
    description: 'Add authentication to outgoing requests',
    icon: <GatewayIcon name="UnlockOutlined" />,
    category: 'logic',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'http',
    label: 'HTTP Call',
    description: 'Call an external API',
    icon: <GatewayIcon name="ApiOutlined" />,
    category: 'action',
    allowedModes: ['INBOUND', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'transform',
    label: 'Transform',
    description: 'Transform request/response data',
    icon: <GatewayIcon name="SwapOutlined" />,
    category: 'logic',
    allowedModes: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'scheduleScript',
    label: 'Schedule Script',
    description: 'Script that computes scheduled execution time',
    icon: <GatewayIcon name="FileTextOutlined" />,
    category: 'logic',
    allowedModes: ['OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Wait before continuing',
    icon: <GatewayIcon name="ClockCircleOutlined" />,
    category: 'logic',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'multiAction',
    label: 'Multi-Action',
    description: 'Deliver to multiple endpoints in order',
    icon: <GatewayIcon name="BranchesOutlined" />,
    category: 'action',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
  {
    type: 'response',
    label: 'Response',
    description: 'Return response to client',
    icon: <GatewayIcon name="CheckCircleOutlined" />,
    category: 'output',
    allowedModes: ['INBOUND'],
    color: cssVar.text.secondary,
  },
  {
    type: 'integration',
    label: 'Integration',
    description: 'Deliver integration to external system',
    icon: <GatewayIcon name="SendOutlined" />,
    category: 'output',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: cssVar.text.secondary,
  },
];

export interface NodePaletteProps {
  mode: IntegrationMode;
  onAddNode: (nodeType: FlowNodeType) => void;
  existingNodeTypes?: FlowNodeType[];
}

export const NodePalette: React.FC<NodePaletteProps> = ({ mode, onAddNode, existingNodeTypes = [] }) => {
  // Filter nodes based on current mode
  const availableNodes = NODE_PALETTE_ITEMS.filter((item) => item.allowedModes.includes(mode));

  // Group nodes by category
  const nodesByCategory = availableNodes.reduce(
    (acc, node) => {
      if (!acc[node.category]) {
        acc[node.category] = [];
      }
      acc[node.category].push(node);
      return acc;
    },
    {} as Record<string, NodePaletteItem[]>
  );

  const categoryLabels = {
    trigger: 'Triggers',
    logic: 'Logic',
    action: 'Actions',
    output: 'Output',
  };

  const categoryOrder: Array<keyof typeof categoryLabels> = ['trigger', 'logic', 'action', 'output'];

  // Check if a node can be added (some nodes like trigger can only have one instance)
  const canAddNode = (nodeType: FlowNodeType): boolean => {
    if (nodeType === 'trigger') {
      return !existingNodeTypes.includes('trigger');
    }
    if (nodeType === 'scheduleScript') {
      return !existingNodeTypes.includes('scheduleScript');
    }
    return true;
  };

  const handleNodeClick = (nodeType: FlowNodeType) => {
    if (canAddNode(nodeType)) {
      onAddNode(nodeType);
    }
  };

  const onDragStart = (event: React.DragEvent, nodeType: FlowNodeType) => {
    if (!canAddNode(nodeType)) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flow-builder-node-palette">
      <Heading level={5} className="console-margin-bottom-4">
        Node Palette
      </Heading>

      <Space direction="vertical" size="middle" className="console-width-full">
        {categoryOrder.map((category) => {
          const nodes = nodesByCategory[category];
          if (!nodes || nodes.length === 0) return null;

          return (
            <div key={category}>
              <AstryxText
                type="supporting"
                color="secondary"
                className="flow-builder-palette-category console-type-caption"
              >
                {categoryLabels[category]}
              </AstryxText>

              <Space direction="vertical" size="small" className="console-width-full">
                {nodes.map((node) => {
                  const disabled = !canAddNode(node.type);
                  const alreadyExists = existingNodeTypes.includes(node.type);

                  return (
                    <Tooltip
                      key={node.type}
                      title={disabled ? `${node.label} already exists (only one allowed)` : node.description}
                      placement="right"
                    >
                      <Card
                        className="flow-builder-palette-item"
                        data-disabled={disabled}
                        size="small"
                        draggable={!disabled}
                        onDragStart={(e) => onDragStart(e, node.type)}
                        onClick={() => handleNodeClick(node.type)}
                        hoverable={!disabled}
                        styles={{
                          body: {
                            padding: 'var(--spacing-2-5) var(--spacing-3)',
                          },
                        }}
                      >
                        <div className="flow-builder-palette-item-content">
                          <div className="flow-builder-palette-item-icon">{node.icon}</div>

                          <div className="console-flex-min-width-0">
                            <div className="flow-builder-palette-item-label console-type-body" data-disabled={disabled}>
                              {node.label}
                              {alreadyExists && node.type === 'trigger' && (
                                <Badge count={1} className="flow-builder-palette-existing-badge" />
                              )}
                            </div>
                            <div className="flow-builder-palette-item-description console-type-caption">{node.description}</div>
                          </div>
                        </div>
                      </Card>
                    </Tooltip>
                  );
                })}
              </Space>
            </div>
          );
        })}
      </Space>

      {/* Help text */}
      <div className="flow-builder-palette-help">
        <AstryxText type="supporting" className="console-type-caption">
          Drag a node onto the canvas, or click it to append.
        </AstryxText>
      </div>
    </div>
  );
};

export default NodePalette;
