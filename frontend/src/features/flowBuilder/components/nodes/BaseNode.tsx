/**
 * BaseNode Component
 *
 * Base component for all custom ReactFlow nodes with consistent styling
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Badge, Tooltip } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import type { FlowNodeData, FlowNodeType } from '../../state/flowTypes';

export type BaseNodeProps = NodeProps<FlowNodeData>;

const NODE_ICONS: Record<FlowNodeType, React.ReactNode> = {
  trigger: <GatewayIcon name="ThunderboltOutlined" />,
  inboundAuth: <GatewayIcon name="LockOutlined" />,
  outboundAuth: <GatewayIcon name="UnlockOutlined" />,
  http: <GatewayIcon name="ApiOutlined" />,
  transform: <GatewayIcon name="SwapOutlined" />,
  filter: <GatewayIcon name="FilterOutlined" />,
  scheduleScript: <GatewayIcon name="FileTextOutlined" />,
  delay: <GatewayIcon name="ClockCircleOutlined" />,
  multiAction: <GatewayIcon name="BranchesOutlined" />,
  response: <GatewayIcon name="CheckCircleOutlined" />,
  integration: <GatewayIcon name="SendOutlined" />,
};

export const BaseNode: React.FC<BaseNodeProps> = ({ id, data, selected = false }) => {
  const icon = NODE_ICONS[data.nodeType];

  const hasErrors = data.errors && data.errors.length > 0;
  const isValid = data.isValid !== false;
  const verticalLayout = data.layoutDirection === 'vertical' || data.layoutDirection === undefined;
  const targetPosition = verticalLayout ? Position.Top : Position.Left;
  const sourcePosition = verticalLayout ? Position.Bottom : Position.Right;

  return (
    <div className="flow-builder-node" data-selected={selected} data-has-errors={Boolean(hasErrors)}>
      {/* Incoming Handle */}
      {data.nodeType !== 'trigger' && (
        <Handle type="target" position={targetPosition} className="flow-builder-node-handle" />
      )}

      {/* Node Content */}
      <div className="flow-builder-node-content">
        {/* Icon */}
        <div className="flow-builder-node-icon" data-selected={selected}>
          {icon}
        </div>

        {/* Label and Description */}
        <div className="console-flex-min-width-0">
          <div className="flow-builder-node-label console-type-section">{data.label}</div>

          {data.description && <div className="flow-builder-node-description">{data.description}</div>}

          {/* Error/Warning Badge */}
          {hasErrors && (
            <Tooltip title={data.errors?.join(', ')} trigger={['hover', 'focus']}>
              <span
                tabIndex={0}
                role="img"
                aria-label={`${data.errors!.length} validation ${data.errors!.length === 1 ? 'error' : 'errors'}: ${data.errors!.join('. ')}`}
              >
                <Badge count={data.errors!.length} className="flow-builder-node-error-count" offset={[0, 0]}>
                  <GatewayIcon size="xsm" name="ExclamationCircleOutlined" className="console-text-error" />
                </Badge>
              </span>
            </Tooltip>
          )}

          {!hasErrors && !isValid && (
            <Tooltip title="This node has validation warnings">
              <GatewayIcon size="xsm" name="WarningOutlined" className="console-text-warning console-margin-top-1-5" />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Outgoing Handle */}
      {data.nodeType !== 'response' && (
        <Handle type="source" position={sourcePosition} className="flow-builder-node-handle" />
      )}
    </div>
  );
};

export default BaseNode;
