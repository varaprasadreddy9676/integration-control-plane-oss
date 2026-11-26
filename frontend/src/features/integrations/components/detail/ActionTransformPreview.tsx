import { useEffect, useState } from 'react';
import { Collapse, Input } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import type { FormInstance } from "@/components/common/LegacyAntdControls";
import { cssVar } from '../../../../design-system/utils';
import { Button } from '../../../../components/common/LegacyButton';

interface ActionTransformPreviewProps {
  actionIndex: number;
  form: FormInstance;
  selectedEventTypeData: any;
  spacing: any;
  token: any;
}

export const ActionTransformPreview = ({
  actionIndex,
  form,
  selectedEventTypeData,
  spacing,
  token,
}: ActionTransformPreviewProps) => {
  const [sampleInput, setSampleInput] = useState('{}');
  const [output, setOutput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-populate sample input when event type data changes
  useEffect(() => {
    if (selectedEventTypeData?.samplePayload && isExpanded) {
      setSampleInput(JSON.stringify(selectedEventTypeData.samplePayload, null, 2));
    }
  }, [selectedEventTypeData, isExpanded]);

  const runPreview = () => {
    try {
      const action = form.getFieldValue(['actions', actionIndex]);
      const payload = JSON.parse(sampleInput || '{}');
      const context = {
        eventType: form.getFieldValue('eventType') || 'TEST_EVENT',
        tenantId: 100,
        entityName: 'Test Entity',
      };

      const script = action?.transformation?.script;
      if (!script) {
        setOutput(JSON.stringify({ error: 'No script defined' }, null, 2));
        return;
      }
      const result = new Function('payload', 'context', script)(payload, context);

      setOutput(JSON.stringify(result, null, 2));
    } catch (err: any) {
      setOutput(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  return (
    <Collapse
      ghost
      activeKey={isExpanded ? ['preview'] : []}
      onChange={(keys) => setIsExpanded(keys.includes('preview'))}
      items={[
        {
          key: 'preview',
          label: (
            <Text type="supporting" color="secondary">
              <GatewayIcon name="ThunderboltOutlined" /> Test Transformation
            </Text>
          ),
          children: (
            <div className="action-transform-preview-grid" style={{ gap: spacing[3] }}>
              <div>
                <Text weight="semibold" display="block" className="console-margin-bottom-1">
                  Sample Input
                </Text>
                <Input.TextArea
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  rows={6}
                  placeholder='{"orderId": 12345}'
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 'var(--console-type-caption)',
                    background: cssVar.table.codeBg,
                    color: cssVar.text.primary,
                  }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing[1] }}>
                  <Text weight="semibold">Output</Text>
                  <Button
                    size="small"
                    type="primary"
                    onClick={runPreview}
                    icon={<GatewayIcon name="ThunderboltOutlined" />}
                  >
                    Run
                  </Button>
                </div>
                <Input.TextArea
                  value={output}
                  readOnly
                  rows={6}
                  placeholder="Click Run to preview"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 'var(--console-type-caption)',
                    background: cssVar.table.codeBg,
                    color: cssVar.text.primary,
                  }}
                />
              </div>
            </div>
          ),
        },
      ]}
    />
  );
};
