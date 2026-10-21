import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CheckCircleFilled, CloseCircleFilled, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  createAlertChannel,
  deleteAlertChannel,
  getAlertChannelPlugins,
  getInboundIntegrations,
  listAlertChannels,
  testAlertChannel,
  updateAlertChannel,
  type AlertChannel,
  type AlertChannelField,
  type AlertChannelPlugin,
} from '../../../services/api';
import { cssVar } from '../../../design-system/utils';

const CHANNELS_KEY = ['alert-channels'];

/** Picks one of the organization's integrations; tells the form its name. */
const IntegrationSelect = ({
  field,
  onPicked,
  ...props
}: {
  field: AlertChannelField;
  onPicked: (name: string) => void;
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
}) => {
  const { data = [], isLoading } = useQuery({ queryKey: ['inbound-integrations-for-alerts'], queryFn: () => getInboundIntegrations() });
  return (
    <Select
      {...props}
      aria-label={field.label}
      loading={isLoading}
      showSearch
      optionFilterProp="label"
      placeholder="Choose an inbound integration"
      notFoundContent={isLoading ? 'Loading…' : 'No inbound integrations yet'}
      options={data.map((integration: any) => ({
        value: String(integration.id || integration._id),
        label: integration.name ? `${integration.name}` : integration.type,
      }))}
      onChange={(value: string, option: any) => {
        props.onChange?.(value);
        onPicked(option?.label || '');
      }}
    />
  );
};

const FieldInput = ({ field, onPicked }: { field: AlertChannelField; onPicked: (name: string) => void }) => {
  const rules = [
    { required: field.required, message: `${field.label} is required` },
    ...(field.pattern ? [{ pattern: new RegExp(field.pattern), message: field.patternMessage || 'Not valid' }] : []),
  ];
  return (
    <Form.Item
      name={['config', field.key]}
      label={field.label}
      extra={field.type === 'list' ? [field.help, 'Separate several with commas.'].filter(Boolean).join(' ') : field.help}
      rules={rules}
      validateTrigger="onBlur"
    >
      {field.type === 'integration' ? (
        <IntegrationSelect field={field} onPicked={onPicked} />
      ) : field.type === 'secret' ? (
        <Input.Password placeholder={field.placeholder} autoComplete="off" />
      ) : (
        <Input placeholder={field.placeholder} autoComplete="off" />
      )}
    </Form.Item>
  );
};

const LastResult = ({ result }: { result: AlertChannel['lastResult'] }) => {
  if (!result) return <Typography.Text type="secondary">Nothing sent yet</Typography.Text>;
  const when = dayjs(result.at).format('MMM D, HH:mm');
  return result.ok ? (
    <Typography.Text type="secondary">
      <CheckCircleFilled style={{ color: cssVar.success.text }} aria-hidden /> Delivered {when}
    </Typography.Text>
  ) : (
    <Typography.Text type="danger">
      <CloseCircleFilled aria-hidden /> Failed {when}: {result.error}
    </Typography.Text>
  );
};

interface Editing {
  channel?: AlertChannel;
  plugin?: AlertChannelPlugin;
}

/**
 * Where this organization's alerts go. Each channel type is a server-side
 * plugin; the form is built from the fields the plugin declares.
 */
export const AlertChannelsCard = ({ style }: { style?: CSSProperties }) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const pluginsQuery = useQuery({ queryKey: ['alert-channel-plugins'], queryFn: getAlertChannelPlugins });
  const channelsQuery = useQuery({ queryKey: CHANNELS_KEY, queryFn: listAlertChannels });
  const plugins = pluginsQuery.data?.plugins || [];
  const events = pluginsQuery.data?.events || [];
  const pluginFor = (type: string) => plugins.find((plugin) => plugin.type === type);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });

  const save = useMutation({
    mutationFn: (values: any) => {
      const plugin = editing?.plugin as AlertChannelPlugin;
      const config: Record<string, string> = {};
      for (const field of plugin.fields) {
        const value = values.config?.[field.key];
        if (value !== undefined && value !== '') config[field.key] = value;
      }
      const body = { name: values.name?.trim() || plugin.name, enabled: values.enabled, events: values.events, config };
      return editing?.channel
        ? updateAlertChannel(editing.channel.id, body)
        : createAlertChannel({ type: plugin.type, ...body });
    },
    onSuccess: () => {
      message.success(editing?.channel ? 'Alert channel saved' : 'Alert channel added');
      setEditing(null);
      refresh();
    },
    onError: (error: Error) => message.error(error.message || 'Could not save the alert channel'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAlertChannel(id, { enabled }),
    onSuccess: refresh,
    onError: (error: Error) => message.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertChannel(id),
    onSuccess: () => {
      message.success('Alert channel removed');
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const sendTest = async (channel: AlertChannel) => {
    setTestingId(channel.id);
    try {
      const result = await testAlertChannel(channel.id);
      if (result.ok) message.success(`Test alert sent to ${channel.name}`);
      else message.error(`${channel.name}: ${result.error || 'test failed'}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Test failed');
    } finally {
      setTestingId(null);
      refresh();
    }
  };

  const startEdit = (channel?: AlertChannel) => {
    form.resetFields();
    const plugin = channel ? pluginFor(channel.type) : undefined;
    if (channel) {
      form.setFieldsValue({
        name: channel.name,
        enabled: channel.enabled,
        events: channel.events,
        config: Object.fromEntries(
          Object.entries(channel.config).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])
        ),
      });
    }
    setEditing({ channel, plugin });
  };

  const choosePlugin = (plugin: AlertChannelPlugin) => {
    setEditing({ plugin });
    form.setFieldsValue({ name: plugin.name, enabled: true, events: events.map((event) => event.type) });
  };

  const submit = async () => {
    try {
      save.mutate(await form.validateFields());
    } catch {
      // fields show what to fix
    }
  };

  const channels = channelsQuery.data || [];
  const isLoading = channelsQuery.isLoading || pluginsQuery.isLoading;

  return (
    <Card
      title="Alert channels"
      style={style}
      extra={
        <Button icon={<PlusOutlined />} onClick={() => startEdit()} disabled={!plugins.length}>
          Add channel
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Where alerts go when something needs attention — an integration or scheduled job failing, the event source
        stopping, failed deliveries piling up — and when it is fixed.
      </Typography.Paragraph>
      {isLoading && <Skeleton active paragraph={{ rows: 3 }} />}
      {(channelsQuery.isError || pluginsQuery.isError) && (
        <Alert type="error" showIcon message="Could not load alert channels" />
      )}
      {!isLoading && channelsQuery.isSuccess && channels.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`No alert channels yet. Add ${plugins.map((plugin) => plugin.name).join(', ')}.`}
        />
      )}
      {channels.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map((channel) => (
            <div
              key={channel.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                border: `1px solid ${cssVar.border.subtle}`,
                borderRadius: 8,
              }}
            >
              <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                <Space size={8} wrap>
                  <Switch
                    size="small"
                    checked={channel.enabled}
                    aria-label={`${channel.name} enabled`}
                    onChange={(enabled) => toggle.mutate({ id: channel.id, enabled })}
                  />
                  <Typography.Text strong>{channel.name}</Typography.Text>
                  <Tag>{pluginFor(channel.type)?.name || channel.type}</Tag>
                  {channel.events.length < events.length && (
                    <Tooltip
                      title={events
                        .filter((event) => channel.events.includes(event.type))
                        .map((event) => event.label)
                        .join(' · ')}
                    >
                      <Tag>
                        {channel.events.length} of {events.length} alerts
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
                <LastResult result={channel.lastResult} />
              </Space>
              <Space size={4}>
                <Button
                  size="small"
                  loading={testingId === channel.id}
                  onClick={() => sendTest(channel)}
                  aria-label={`Send test to ${channel.name}`}
                >
                  Send test
                </Button>
                <Button size="small" onClick={() => startEdit(channel)}>
                  Edit
                </Button>
                <Popconfirm
                  title={`Remove ${channel.name}?`}
                  description="Alerts will no longer be sent here."
                  okText="Remove"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(channel.id)}
                >
                  <Button size="small" danger>
                    Remove
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={editing?.channel ? `Edit ${editing.channel.name}` : 'Add alert channel'}
        onCancel={() => setEditing(null)}
        destroyOnClose
        okText="Save channel"
        onOk={submit}
        okButtonProps={{ disabled: !editing?.plugin, loading: save.isPending }}
      >
        {editing && !editing.channel && (
          <Radio.Group
            value={editing.plugin?.type}
            onChange={(event) => choosePlugin(pluginFor(event.target.value) as AlertChannelPlugin)}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 16 }}
          >
            {plugins.map((plugin) => (
              <Radio.Button key={plugin.type} value={plugin.type} style={{ height: 'auto', padding: '8px 12px', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 600 }}>{plugin.name}</div>
                <div style={{ fontSize: 12, color: cssVar.text.secondary, whiteSpace: 'normal' }}>{plugin.description}</div>
              </Radio.Button>
            ))}
          </Radio.Group>
        )}
        {editing?.plugin && (
          <Form form={form} layout="vertical" requiredMark="optional" preserve={false}>
            <Form.Item name="name" label="Name">
              <Input placeholder={editing.plugin.name} />
            </Form.Item>
            {editing.plugin.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                onPicked={(picked) => {
                  // Name the channel after the integration unless the user named it.
                  const current = form.getFieldValue('name');
                  if (picked && (!current || current === editing.plugin?.name)) form.setFieldsValue({ name: picked });
                }}
              />
            ))}
            {editing.channel && editing.plugin.fields.some((field) => field.type === 'secret') && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
                Hidden values stay as they are unless you replace them.
              </Typography.Paragraph>
            )}
            <Form.Item
              name="events"
              label="Send"
              rules={[{ required: true, message: 'Pick at least one alert' }]}
            >
              <Checkbox.Group options={events.map((event) => ({ label: event.label, value: event.type }))} />
            </Form.Item>
            <Form.Item name="enabled" label="On" valuePropName="checked" extra="Turn off to pause this channel without removing it.">
              <Switch aria-label="Channel on" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </Card>
  );
};
