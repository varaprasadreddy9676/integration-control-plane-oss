/**
 * Flow Run Panel Component
 *
 * Bottom panel showing test execution results and logs
 */

import React from 'react';
import { Drawer, Timeline, Space, Card, Collapse } from '@/components/common/LegacyAntdControls';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Banner } from '@astryxdesign/core/Banner';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { copyTextToClipboard } from '../../../utils/clipboard';
import type { FlowExecutionResult, FlowExecutionStep } from '../state/flowTypes';
import { StatePanel } from '../../../components/common/StatePanel';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Button } from '../../../components/common/LegacyButton';

const { Panel } = Collapse;

export interface FlowRunPanelProps {
  visible: boolean;
  executionResult: FlowExecutionResult | null;
  onClose: () => void;
}

export const FlowRunPanel: React.FC<FlowRunPanelProps> = ({ visible, executionResult, onClose }) => {
  const copyToClipboard = (text: string) => {
    void copyTextToClipboard(text);
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusIcon = (status: 'success' | 'failed' | 'skipped') => {
    switch (status) {
      case 'success':
        return <GatewayIcon name="CheckCircleOutlined" className="console-text-secondary" />;
      case 'failed':
        return <GatewayIcon name="CloseCircleOutlined" className="console-text-secondary" />;
      case 'skipped':
        return <GatewayIcon name="ClockCircleOutlined" className="console-text-muted" />;
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <Heading level={5} className="console-margin-none">
            Test Execution Results
          </Heading>
          {executionResult && (
            <StatusBadge
              status={executionResult.success ? 'SUCCESS' : 'FAILED'}
              label={executionResult.success ? 'Success' : 'Failed'}
              variant={executionResult.success ? 'success' : 'error'}
            />
          )}
        </Space>
      }
      placement="bottom"
      onClose={onClose}
      open={visible}
      height="50vh"
      extra={<Button type="text" icon={<GatewayIcon name="CloseOutlined" />} onClick={onClose} />}
    >
      {!executionResult ? (
        <StatePanel size="compact" glyph="searching" title="No test results" />
      ) : (
        <div className="flow-run-content">
          {/* Summary */}
          <Card size="small" className="console-margin-bottom-6">
            <Space direction="vertical" className="console-width-full">
              <div className="console-flex-between">
                <Space>
                  <AstryxText weight="semibold">Total Execution Time:</AstryxText>
                  <AstryxText>{formatDuration(executionResult.executionTime)}</AstryxText>
                </Space>
                <Space>
                  <AstryxText weight="semibold">Steps:</AstryxText>
                  <AstryxText>{executionResult.steps.length}</AstryxText>
                </Space>
              </div>

              {executionResult.error && (
                <Banner
                  status="error"
                  title="Execution Error"
                  description={
                    <div>
                      <div className="console-margin-bottom-2">
                        <strong>Message:</strong> {executionResult.error.message}
                      </div>
                      {executionResult.error.nodeId && (
                        <div className="console-margin-bottom-2">
                          <strong>Node ID:</strong> {executionResult.error.nodeId}
                        </div>
                      )}
                      {executionResult.error.stack && (
                        <details>
                          <summary className="console-cursor-pointer console-margin-top-2">View Stack Trace</summary>
                          <pre className="clamped-code-block flow-run-stack-code">{executionResult.error.stack}</pre>
                        </details>
                      )}
                    </div>
                  }
                />
              )}

              {executionResult.output && (
                <div>
                  <div className="console-row-between-center-spaced">
                    <AstryxText weight="semibold">Output:</AstryxText>
                    <Button
                      size="small"
                      icon={<GatewayIcon name="CopyOutlined" />}
                      onClick={() => copyToClipboard(JSON.stringify(executionResult.output, null, 2))}
                    >
                      Copy
                    </Button>
                  </div>
                  <pre className="clamped-code-block flow-run-output-code">
                    {JSON.stringify(executionResult.output, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>

          {/* Execution steps timeline */}
          <Heading level={5} className="console-margin-bottom-4">
            Execution Steps
          </Heading>

          <Timeline
            items={executionResult.steps.map((step, index) => ({
              dot: getStatusIcon(step.status),
              children: (
                <Card key={index} size="small" className="flow-run-step-card console-margin-bottom-2">
                  <div className="console-row-between-center-spaced">
                    <Space>
                      <AstryxText weight="semibold">{step.nodeType}</AstryxText>
                      <StatusBadge
                        status={step.status.toUpperCase()}
                        label={step.status.charAt(0).toUpperCase() + step.status.slice(1)}
                        variant={step.status === 'success' ? 'success' : step.status === 'failed' ? 'error' : 'neutral'}
                      />
                    </Space>
                    <AstryxText type="supporting" color="secondary">
                      {formatDuration(step.durationMs)}
                    </AstryxText>
                  </div>

                  <AstryxText type="supporting" color="secondary" className="console-type-caption">
                    Node ID: {step.nodeId}
                  </AstryxText>

                  {step.error && <Banner status="error" title={step.error} />}

                  {(step.input || step.output) && (
                    <Collapse
                      ghost
                      className="console-margin-top-2"
                      expandIcon={({ isActive }) => <GatewayIcon name="DownOutlined" rotate={isActive ? 180 : 0} />}
                    >
                      {step.input && (
                        <Panel
                          header={
                            <AstryxText type="supporting" color="secondary">
                              Input Data
                            </AstryxText>
                          }
                          key="input"
                        >
                          <pre className="clamped-code-block flow-run-output-code flow-run-output-code--compact">
                            {JSON.stringify(step.input, null, 2)}
                          </pre>
                        </Panel>
                      )}

                      {step.output && (
                        <Panel
                          header={
                            <AstryxText type="supporting" color="secondary">
                              Output Data
                            </AstryxText>
                          }
                          key="output"
                        >
                          <pre className="clamped-code-block flow-run-output-code flow-run-output-code--compact">
                            {JSON.stringify(step.output, null, 2)}
                          </pre>
                        </Panel>
                      )}
                    </Collapse>
                  )}
                </Card>
              ),
            }))}
          />
        </div>
      )}
    </Drawer>
  );
};

export default FlowRunPanel;
