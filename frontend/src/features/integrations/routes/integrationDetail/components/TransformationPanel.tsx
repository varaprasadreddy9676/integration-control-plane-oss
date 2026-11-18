import type { ReactNode } from 'react';
import { Skeleton, Typography, Row, Col, Alert } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { spacingToNumber } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { SectionCard } from './SectionCard';

interface TransformationPanelProps {
  isCreate: boolean;
  isEditMode: boolean;
  selectedEventType?: string;
  scriptValue: string;
  /** The editor, shown in place while the integration is being edited. */
  editor?: ReactNode;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  formatScriptForDisplay: (script?: string) => string;
  isLoading?: boolean;
}

export const TransformationPanelHeader = ({
  spacing,
  colors
}: Pick<TransformationPanelProps, 'spacing' | 'colors'>) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    <ThunderboltOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>Payload Transformation</Typography.Text>
    </div>
  </div>
);

export const TransformationPanelContent = ({
  isCreate,
  isEditMode,
  selectedEventType,
  scriptValue,
  editor,
  spacing,
  token,
  formatScriptForDisplay,
  isLoading = false
}: TransformationPanelProps) => {
  if (isLoading) {
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  // Disable transformation section until event type is selected
  if (!selectedEventType) {
    return (
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            message="Select an event type first"
            description="Payload transformation configuration will be available after you select an event type in the Configuration section above."
            style={{ marginBottom: 0 }}
          />
        </Col>
      </Row>
    );
  }

  return (
    <SectionCard
      title="Payload Transformation"
      description="Transform event payloads before delivery"
      spacing={spacing}
      token={token}
    >
      {isCreate || isEditMode ? (
        editor
      ) : scriptValue ? (
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
            Transformation Script:
          </Typography.Text>
          <MonacoEditorInput height="300px" value={formatScriptForDisplay(scriptValue)} readOnly />
        </div>
      ) : (
        <Typography.Text type="secondary">No transformation: the event is sent as it is.</Typography.Text>
      )}
    </SectionCard>
  );
};
