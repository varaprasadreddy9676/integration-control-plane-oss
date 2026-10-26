import { Button, Skeleton, Space, Tag, Typography, Row, Col, Alert } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { cssVar, spacingToNumber, } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { SectionCard } from './SectionCard';

interface TransformationPanelProps {
  isCreate: boolean;
  isEditMode: boolean;
  selectedEventType?: string;
  scriptValue: string;
  lastPreviewMeta?: { durationMs?: number; status?: number };
  spacing: Record<string, string>;
  token: any;
  colors: any;
  onPreview: () => void;
  onOpenDesigner: () => void;
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
  lastPreviewMeta,
  spacing,
  token,
  onPreview,
  onOpenDesigner,
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
      headerExtras={
        (isCreate || isEditMode) ? (
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={onPreview}
            >
              Preview
            </Button>
            <Button
              onClick={onOpenDesigner}
              type="primary"
            >
              Configure Transformation
            </Button>
          </Space>
        ) : undefined
      }
    >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: spacingToNumber(spacing[3]),
              padding: `${spacing[4]} ${spacing[4]}`,
              background: cssVar.bg.subtle,
              borderRadius: token.borderRadius,
              border: `1px solid ${cssVar.border.default}`
            }}
          >
            {lastPreviewMeta && (
              <div style={{ display: 'flex', gap: spacingToNumber(spacing[1]), alignItems: 'center' }}>
                <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>Last Preview:</Typography.Text>
                <Tag>{lastPreviewMeta.durationMs ?? 0} ms</Tag>
              </div>
            )}

            {!isCreate && !isEditMode && scriptValue && (
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                  Transformation Script:
                </Typography.Text>
                <MonacoEditorInput
                  height="300px"
                  value={formatScriptForDisplay(scriptValue)}
                  readOnly
                />
              </div>
            )}

            {!scriptValue && (
              <Typography.Text type="secondary">No transformation: the event is sent as it is.</Typography.Text>
            )}
          </div>
    </SectionCard>
  );
};
