import { useState } from 'react';
import {
  App,
  AutoComplete,
  Card,
  Form,
  Input,
  Modal,
  Result,
  Space,
  Switch,
} from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
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
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { InlineNotice as Notice } from '../../../components/common';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Messaging: <GatewayIcon name="MessageOutlined" aria-hidden />,
  Payments: <GatewayIcon name="CreditCardOutlined" aria-hidden />,
  CRM: <GatewayIcon name="TeamOutlined" aria-hidden />,
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
        filterOption={(text, option) =>
          String(option?.value || '')
            .toLowerCase()
            .includes(text.toLowerCase())
        }
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
  const copyEndpointUrl = async () => {
    if (!created?.endpointUrl) return;
    const copied = await copyTextToClipboard(created.endpointUrl);
    if (copied) message.success('Endpoint URL copied');
    else message.error('Could not copy endpoint URL');
  };

  const submit = async () => {
    if (!active) return;
    let values: Record<string, string>;
    try {
      values = await form.validateFields();
    } catch {
      return; // the form already shows what to fix next to each field
    }
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
    <section aria-labelledby="quick-setup-heading" className="ui-extracted-1a0543ca12">
      <Heading level={5} id="quick-setup-heading" className="console-margin-bottom-1">
        Quick setup
      </Heading>
      <Text as="p" display="block" type="supporting" color="secondary" className="console-margin-bottom-3">
        Connect a common service in one step. You can edit everything afterwards.
      </Text>
      <div
        className="ui-extracted-2d8d511c2c"
      >
        {(catalogQuery.data || []).map((template) => (
          <Card key={template.id} size="small" style={{ borderColor: cssVar.border.default }}>
            <Space align="start" size={12} className="console-width-full">
              <span style={{ fontSize: 'var(--console-type-title)', color: cssVar.accent.text }}>
                {CATEGORY_ICON[template.category] || <GatewayIcon name="ApiOutlined" aria-hidden />}
              </span>
              <div className="console-min-width-0">
                <Text weight="semibold">{template.name}</Text>
                <Text
                  as="p"
                  display="block"
                  type="supporting"
                  size="base"
                  color="secondary"
                  className="ui-extracted-b805e0ab82"
                >
                  {template.description}
                </Text>
                <Space size={6} wrap>
                  <StatusBadge
                    label={template.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}
                    variant="info"
                    showIcon={false}
                  />
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => open(template)}
                    aria-label={`Set up ${serviceName(template)}`}
                  >
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
        destroyOnHidden
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
            <Text as="p" display="block" type="supporting" color="secondary">
              {active.description}
              {active.docsUrl && (
                <>
                  {' '}
                  <a href={active.docsUrl} target="_blank" rel="noreferrer">
                    {serviceName(active)} docs
                  </a>
                </>
              )}
            </Text>
            {active.inputs.map((input) => (
              <InputField key={input.key} input={input} eventTypes={eventTypesQuery.data || []} />
            ))}
            <Space>
              <Switch checked={activate} onChange={setActivate} aria-label="Activate immediately" />
              <Text>Activate immediately</Text>
            </Space>
            <Text as="p" display="block" type="supporting" size="sm" color="secondary" className="console-margin-top-1">
              Leave it off to review and test first; it is created as a draft.
            </Text>
          </Form>
        )}
        {created && (
          <Result
            status="success"
            title={`${serviceName(created.template)} integration created`}
            subTitle={activate ? 'It is active.' : 'It is a draft: open it to test, then switch it on.'}
            extra={
              created.endpointUrl && (
                <Notice
                  type="info"
                  className="ui-extracted-10c394e423"
                  message={`Give this URL to ${serviceName(created.template)}`}
                  description={
                    <Space align="start" className="console-width-full-between">
                      <Text type="code" wordBreak="break-word" className="ui-extracted-17e73af734">
                        {created.endpointUrl}
                      </Text>
                      <Button
                        size="small"
                        type="text"
                        icon={<GatewayIcon name="CopyOutlined" />}
                        aria-label="Copy endpoint URL"
                        onClick={() => void copyEndpointUrl()}
                      />
                    </Space>
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
