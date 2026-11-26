/**
 * Flow Canvas Component
 *
 * Main ReactFlow canvas for the visual flow builder
 */

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Connection,
  Edge,
  ConnectionMode,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { message } from "@/components/common/LegacyAntdControls";
import { cssVar } from '../../../design-system/utils';

import { nodeTypes } from './nodes';
import type { FlowNode, FlowEdge, IntegrationMode, FlowNodeType } from '../state/flowTypes';
import { isConnectionAllowed } from '../state/flowSchema';

export interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  mode: IntegrationMode;
  onNodesChange?: (nodes: FlowNode[]) => void;
  onEdgesChange?: (edges: FlowEdge[]) => void;
  onNodeSelect?: (nodeId: string | null) => void;
  onEdgeSelect?: (edgeId: string | null) => void;
  readOnly?: boolean;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  nodes: externalNodes,
  edges: externalEdges,
  mode,
  onNodesChange: externalOnNodesChange,
  onEdgesChange: externalOnEdgesChange,
  onNodeSelect,
  onEdgeSelect,
  readOnly = false,
}) => {
  // Internal state management with external sync
  const [internalNodes, setInternalNodes] = React.useState<FlowNode[]>(externalNodes);
  const [internalEdges, setInternalEdges] = React.useState<FlowEdge[]>(externalEdges);
  const internalNodesRef = React.useRef(externalNodes);
  const internalEdgesRef = React.useRef(externalEdges);

  // Sync external changes to internal state
  React.useEffect(() => {
    internalNodesRef.current = externalNodes;
    setInternalNodes(externalNodes);
  }, [externalNodes]);

  React.useEffect(() => {
    internalEdgesRef.current = externalEdges;
    setInternalEdges(externalEdges);
  }, [externalEdges]);

  // Handle node changes (drag, select, etc.)
  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return;

      const newNodes = applyNodeChanges(changes, internalNodesRef.current) as FlowNode[];
      internalNodesRef.current = newNodes;
      setInternalNodes(newNodes);
      externalOnNodesChange?.(newNodes);
    },
    [readOnly, externalOnNodesChange]
  );

  // Handle edge changes (select, delete, etc.)
  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;

      const newEdges = applyEdgeChanges(changes, internalEdgesRef.current) as FlowEdge[];
      internalEdgesRef.current = newEdges;
      setInternalEdges(newEdges);
      externalOnEdgesChange?.(newEdges);
    },
    [readOnly, externalOnEdgesChange]
  );

  // Validate connection before allowing it
  const isValidConnection = useCallback(
    (connection: Connection): boolean => {
      if (readOnly) return false;

      const sourceNode = internalNodes.find((n) => n.id === connection.source);
      const targetNode = internalNodes.find((n) => n.id === connection.target);

      if (!sourceNode || !targetNode) return false;

      // Check if connection is allowed based on schema rules
      const allowed = isConnectionAllowed(sourceNode.type as FlowNodeType, targetNode.type as FlowNodeType, mode);

      if (!allowed) {
        message.warning(`Cannot connect ${sourceNode.type} to ${targetNode.type} in ${mode} mode`);
      }

      return allowed;
    },
    [internalNodes, mode, readOnly]
  );

  // Handle new connections
  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;

      if (!isValidConnection(connection)) return;

      const newEdge: FlowEdge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle || undefined,
        targetHandle: connection.targetHandle || undefined,
        type: 'default',
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
      };
      const newEdges = addEdge(newEdge, internalEdgesRef.current) as FlowEdge[];
      internalEdgesRef.current = newEdges;
      setInternalEdges(newEdges);
      externalOnEdgesChange?.(newEdges);
    },
    [readOnly, isValidConnection, externalOnEdgesChange]
  );

  // Handle node selection
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      if (onNodeSelect) {
        onNodeSelect(node.id);
      }
    },
    [onNodeSelect]
  );

  const handleSelectionChange = useCallback(
    ({ nodes }: { nodes: FlowNode[] }) => {
      onNodeSelect?.(nodes[0]?.id ?? null);
    },
    [onNodeSelect]
  );

  // Handle edge selection
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: FlowEdge) => {
      if (onEdgeSelect) {
        onEdgeSelect(edge.id);
      }
    },
    [onEdgeSelect]
  );

  // Handle canvas click (deselect)
  const handlePaneClick = useCallback(() => {
    if (onNodeSelect) {
      onNodeSelect(null);
    }
    if (onEdgeSelect) {
      onEdgeSelect(null);
    }
  }, [onNodeSelect, onEdgeSelect]);

  // Custom edge styles
  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'default',
      animated: false,
      style: { stroke: cssVar.border.default, strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: cssVar.border.default,
      },
    }),
    []
  );

  return (
    <div className="ui-extracted-918c638048">
      <ReactFlow
        nodes={internalNodes}
        edges={internalEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onSelectionChange={handleSelectionChange}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{
          padding: 0.2,
          minZoom: window.innerWidth <= 767 ? 0.75 : 0.8,
          maxZoom: 1.5,
        }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        snapToGrid={true}
        snapGrid={[15, 15]}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
      >
        {/* Grid background */}
        <Background color={cssVar.border.subtle} gap={15} size={1} variant={BackgroundVariant.Dots} />

        {/* Zoom/pan controls */}
        <Controls showZoom={true} showFitView={true} showInteractive={!readOnly} />

        {/* Minimap */}
        {internalNodes.length > 0 && (
          <MiniMap
            position="top-right"
            nodeColor={() => cssVar.accent.text}
            maskColor="rgba(0, 0, 0, 0.1)"
            style={{
              width: 112,
              height: 68,
              background: cssVar.bg.base,
              border: `1px solid ${cssVar.border.default}`,
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
};

export default FlowCanvas;
