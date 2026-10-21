import { useState } from 'react';
import { Alert, App, AutoComplete, Button, Card, Form, Input, Modal, Result, Space, Switch, Tag, Typography } from 'antd';
import { ApiOutlined, CreditCardOutlined, MessageOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  buildFromTemplateCatalog,
  createInboundIntegration,
  createIntegration,
  getApiBaseUrl,
  getEventTypes,
  getTemplateCatalog,
  type TemplateCatalogEntry,
  type TemplateCatalogInput,
} from '../../../services/api';
import { cssVar } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import { useTenant } from '../../../app/tenant-context';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Messaging: <MessageOutlined aria-hidden />,
  Payments: <CreditCardOutlined aria-hidden />,
  CRM: <TeamOutlined aria-hidden />,
};

/** "Slack: post events to a channel" → "Slack" */
const serviceName = (template: TemplateCatalogEntry) => template.name.split(':')[0];

interface Created {
  template: TemplateCatalogEntry;
  path: string;
  /** For inbound setups: the URL the external service must call. */
  endpointUrl?: string;
}

const InputField = ({ input, eventTypes }: { input: TemplateCatalogInput; eventTypes: string[] }) => {
  const rules = [
    { required: input.required, message: `${input.label} is required` },
    ...(input.pattern ? [{ pattern: new RegExp(input.pattern), message: input.patternMessage || 'Not valid' }] : []),
  ];
  const control =
    input.type === 'eventType' ? (
      <AutoComplete
        options={eventTypes.map((value) => ({ value }))}
        filterOption={(text, option) => String(option?.value || '').toLowerCase().includes(text.toLowerCase())}
        placeholder="Pick or type an event, e.g. ORDER_PLACED"
      />
    ) : input.type === 'secret' ? (
      <Input.Password placeholder={input.placeholder} autoComplete="off" />
    ) : (
      <Input placeholder={input.placeholder} autoComplete="off" />
    );
  return (
    <Form.Item
      name={input.key}
      label={input.label}
      extra={input.help}
      rules={rules}
      validateTrigger="onBlur"
      initialValue={input.default}
    >
      {control}
    </Form.Item>
  );
};

/** One-step setups for common services, shown at the top of the Templates page. */
export const QuickSetupSection = () => {
  const { message } = App.useApp();
  const navigate = useNavigateWithParams();
  const { orgId } = useTenant();
  const [form] = Form.useForm();
  const [active, setActive] = useState<TemplateCatalogEntry | null>(null);
  const [activate, setActivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const catalogQuery = useQuery({ queryKey: ['template-catalog'], queryFn: getTemplateCatalog });
  const eventTypesQuery = useQuery({
    queryKey: ['event-types', orgId],
    queryFn: getEventTypes,
    enabled: Boolean(active?.inputs.some((input) => input.type === 'eventType')),
  });

  const open = (template: TemplateCatalogEntry) => {
    form.resetFields();
    setActivate(false);
    setCreated(null);
    setActive(template);
  };
  const close = () => {
    setActive(null);
    setCreated(null);
  };

  const submit = async () => {
    if (!active) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const built = await buildFromTemplateCatalog(active.id, values, activate);
      if (built.direction === 'INBOUND') {
        const result = await createInboundIntegration(built.payload);
        const id = result?.id ?? result?.data?.id;
        setCreated({
          template: active,
          path: `/inbound-integrations/${id}`,
          endpointUrl: `${getApiBaseUrl()}/public/integrations/${built.payload.type}?orgId=${orgId}`,
        });
      } else {
        const result = await createIntegration(built.payload);
        setCreated({ template: active, path: `/integrations/${result.id}` });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not create the integration');
    } finally {
      setSubmitting(false);
    }
  };

  if (catalogQuery.isError || (catalogQuery.isSuccess && catalogQuery.data.length === 0)) return null;

  return (
    <section aria-labelledby="quick-setup-heading" style={{ marginBottom: 24 }}>
      <Typography.Title level={5} id="quick-setup-heading" style={{ marginBottom: 4 }}>
        Quick setup
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Connect a common service in one step. You can edit everything afterwards.
      </Typography.Paragraph>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {(catalogQuery.data || []).map((template) => (
          <Card key={template.id} size="small" style={{ borderColor: cssVar.border.default }}>
            <Space align="start" size={12} style={{ width: '100%' }}>
              <span style={{ fontSize: 20, color: cssVar.accent.text }}>
                {CATEGORY_ICON[template.category] || <ApiOutlined aria-hidden />}
              </span>
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>{template.name}</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 13 }}>
                  {template.description}
                </Typography.Paragraph>
                <Space size={6} wrap>
                  <Tag>{template.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}</Tag>
                  <Button size="small" type="primary" onClick={() => open(template)} aria-label={`Set up ${serviceName(template)}`}>
                    Set up
                  </Button>
                </Space>
              </div>
            </Space>
          </Card>
        ))}
      </div>

      <Modal
        open={Boolean(active)}
        title={active?.name}
        onCancel={close}
        destroyOnClose
        footer={
          created
            ? [
                <Button key="close" onClick={close}>
                  Done
                </Button>,
                <Button key="open" type="primary" onClick={() => navigate(created.path)}>
                  Open integration
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={close}>
                  Cancel
                </Button>,
                <Button key="create" type="primary" loading={submitting} onClick={submit}>
                  Create integration
                </Button>,
              ]
        }
      >
        {active && !created && (
          <Form form={form} layout="vertical" requiredMark="optional">
            <Typography.Paragraph type="secondary">
              {active.description}
              {active.docsUrl && (
                <>
                  {' '}
                  <Typography.Link href={active.docsUrl} target="_blank" rel="noreferrer">
                    {serviceName(active)} docs
                  </Typography.Link>
                </>
              )}
            </Typography.Paragraph>
            {active.inputs.map((input) => (
              <InputField key={input.key} input={input} eventTypes={eventTypesQuery.data || []} />
            ))}
            <Space>
              <Switch checked={activate} onChange={setActivate} aria-label="Activate immediately" />
              <Typography.Text>Activate immediately</Typography.Text>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 4, fontSize: 12 }}>
              Leave it off to review and test first; it is created as a draft.
            </Typography.Paragraph>
          </Form>
        )}
        {created && (
          <Result
            status="success"
            title={`${serviceName(created.template)} integration created`}
            subTitle={activate ? 'It is active.' : 'It is a draft: open it to test, then switch it on.'}
            extra={
              created.endpointUrl && (
                <Alert
                  type="info"
                  showIcon
                  style={{ textAlign: 'left' }}
                  message={`Give this URL to ${serviceName(created.template)}`}
                  description={
                    <Typography.Paragraph copyable style={{ margin: 0, fontFamily: 'var(--font-mono, monospace)' }}>
                      {created.endpointUrl}
                    </Typography.Paragraph>
                  }
                />
              )
            }
          />
        )}
      </Modal>
    </section>
  );
};
