import { useState } from 'react';
import { Empty, Form, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getIntegrationById } from '../../../services/api';
import { WorkflowCanvas } from '../canvas/WorkflowCanvas';
import { deliveriesOf } from '../deliveryTargets';

/**
 * One delivery drawn over its integration's flow: the path it took, where it failed and what was not
 * reached. It belongs with the delivery (Delivery Logs); the integration's configuration only edits the flow.
 */
export const DeliveryFlow = ({ integrationId, logId }: { integrationId: string; logId: string }) => {
  const [form] = Form.useForm();
  const [fullscreen, setFullscreen] = useState(false);
  const integration = useQuery({
    queryKey: ['delivery-flow-integration', integrationId],
    queryFn: () => getIntegrationById(integrationId),
    staleTime: 60 * 1000,
  });

  if (integration.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!integration.data) return <Empty description="This integration can no longer be shown." image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const config = integration.data as unknown as Record<string, unknown>;
  return (
    <Form form={form} initialValues={config} component={false}>
      <div style={{ width: '100%', height: fullscreen ? undefined : 'max(520px, 62vh)' }}>
        <WorkflowCanvas
          form={form}
          integrationId={integrationId}
          targets={deliveriesOf(config as Parameters<typeof deliveriesOf>[0])}
          context={() => config}
          deliveryLogId={logId}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
        />
      </div>
    </Form>
  );
};
