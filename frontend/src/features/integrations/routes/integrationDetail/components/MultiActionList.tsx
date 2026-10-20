import { Alert, Button, Col, Collapse, Form, Input, Row, Select, Space, Switch, Tag, Typography, theme } from 'antd';
import type { FormInstance } from 'antd';
import {
  ArrowRightOutlined,
  DeleteOutlined,
  PlusOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { cssVar, spacingToNumber, withAlpha } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { ActionTransformPreview } from '../../../components/detail/ActionTransformPreview';
import { FormAlerts } from '../../../components/common';
import { SectionCard } from './SectionCard';
import { getLookupTypes } from '../../../../../services/api';

interface MultiActionListProps {
  form: FormInstance;
  isCreate: boolean;
  isEditMode: boolean;
  isMultiAction: boolean;
  actionsCount: number;
  existingActionsCount: number;
  uiConfig: any;
  selectedEventTypeData: any;
  availableFields: any[];
  spacing: Record<string, string>;
  token: any;
  colors: any;
  loadCleverTapTemplate: () => void;
  multiActionValidationErrors: string[];
  formatScriptForDisplay: (script?: string) => string;
}

export const MultiActionList = ({
  form,
  isCreate,
  isEditMode,
  isMultiAction,
  actionsCount,
  existingActionsCount,
  uiConfig,
  selectedEventTypeData,
  availableFields,
  spacing,
  token,
  colors,
  loadCleverTapTemplate,
  multiActionValidationErrors,
  formatScriptForDisplay,
}: MultiActionListProps) => {
  // Fetch lookup types for dropdown
  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes,
  });
  const lookupTypes = typesData?.types || [];

  return (
    <SectionCard
      icon={<BranchesOutlined />}
      title="Multi-Action Configuration"
      description="Configure multiple sequential API calls for a single event (e.g., CleverTap profile + event upload)"
      spacing={spacing}
      token={token}
    >
      <Collapse
        defaultActiveKey={isMultiAction || existingActionsCount > 0 ? ['actions'] : []}
        expandIconPosition="end"
        style={{ background: 'transparent', border: 'none' }}
        items={[
          {
            key: 'actions',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  Multi-Action Configuration
                </Typography.Text>
                {isMultiAction && (
                  <Tag color="success">
                    {actionsCount} action{actionsCount !== 1 ? 's' : ''}
                  </Tag>
                )}
              </div>
            ),
            children: (
              <Row gutter={[spacingToNumber(spacing[4]), 0]}>
                <Col xs={24}>
                  <Alert
                    type="info"
                    closable
                    message="Multi-Action Mode"
                    description={
                      <div style={{ fontSize: token.fontSizeSM }}>
                        Execute multiple HTTP or HL7 MLLP deliveries per event. Actions run sequentially.
                        <div style={{ marginTop: spacing[2] }}>
                          <Button
                            type="primary"
                            size="small"
                            onClick={loadCleverTapTemplate}
                            style={{ marginRight: spacing[2] }}
                          >
                            Load CleverTap Template
                          </Button>
                          <Typography.Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                            Pre-configured example
                          </Typography.Text>
                        </div>
                      </div>
                    }
                    showIcon
                    style={{
                      marginBottom: spacingToNumber(spacing[4]),
                      background: withAlpha(cssVar.info.bg, 0.6),
                      border: `1px solid ${cssVar.info.border}`,
                      color: cssVar.text.primary,
                    }}
                  />
                </Col>

                <Col xs={24}>
                  <Form.List name="actions">
                    {(fields, { add, remove, move }) => (
                      <>
                        {fields.length === 0 && (
                          <Alert
                            type="info"
                            message="No actions configured yet"
                            description="Add your first action to define the target URL, method, and transformation."
                            showIcon
                            style={{
                              marginBottom: spacingToNumber(spacing[3]),
                              background: withAlpha(cssVar.info.bg, 0.6),
                              border: `1px solid ${cssVar.info.border}`,
                            }}
                            action={
                              <Button
                                type="primary"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={() =>
                                  add({ kind: 'HTTP', name: '', httpMethod: 'POST', transformationMode: 'SCRIPT' })
                                }
                              >
                                Add Action
                              </Button>
                            }
                          />
                        )}
                        {fields.map(({ key, name, ...restField }, index) => (
                          <div
                            key={key}
                            style={{
                              marginBottom: spacingToNumber(spacing[4]),
                              padding: spacingToNumber(spacing[4]),
                              background: cssVar.bg.elevated,
                              border: `1px solid ${cssVar.border.default}`,
                              borderRadius: token.borderRadius,
                            }}
                          >
                            <Row gutter={[spacingToNumber(spacing[3]), 0]}>
                              <Col xs={24}>
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: spacingToNumber(spacing[3]),
                                  }}
                                >
                                  <Typography.Text strong style={{ fontSize: 15 }}>
                                    Action {index + 1}
                                  </Typography.Text>
                                  <Space>
                                    {index > 0 && (
                                      <Button
                                        type="text"
                                        size="small"
                                        onClick={() => move(index, index - 1)}
                                        title="Move up"
                                      >
                                        ↑
                                      </Button>
                                    )}
                                    {index < fields.length - 1 && (
                                      <Button
                                        type="text"
                                        size="small"
                                        onClick={() => move(index, index + 1)}
                                        title="Move down"
                                      >
                                        ↓
                                      </Button>
                                    )}
                                    <Button
                                      type="text"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                      size="small"
                                    >
                                      Remove
                                    </Button>
                                  </Space>
                                </div>
                              </Col>

                              <Col xs={24} md={12}>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'name']}
                                  label="Action Name"
                                  rules={[{ required: true, message: 'Action name is required' }]}
                                >
                                  <Input placeholder="e.g., Profile Upload" size="middle" />
                                </Form.Item>
                              </Col>

                              <Col xs={24} md={12}>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'kind']}
                                  label="Delivery Protocol"
                                  initialValue="HTTP"
                                >
                                  <Select
                                    options={[
                                      { value: 'HTTP', label: 'HTTP API' },
                                      { value: 'HL7_MLLP', label: 'HL7 MLLP' },
                                    ]}
                                    size="middle"
                                  />
                                </Form.Item>
                              </Col>

                              <Form.Item noStyle shouldUpdate>
                                {() => {
                                  const actionKind = form.getFieldValue(['actions', name, 'kind']) || 'HTTP';

                                  if (actionKind === 'HL7_MLLP') {
                                    return (
                                      <>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'host']}
                                            label="MLLP Host"
                                            rules={[{ required: true, message: 'MLLP host is required' }]}
                                          >
                                            <Input placeholder="10.0.0.25" size="middle" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'port']}
                                            label="MLLP Port"
                                            rules={[{ required: true, message: 'MLLP port is required' }]}
                                          >
                                            <Input type="number" placeholder="2575" size="middle" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'connectTimeoutMs']}
                                            label="Connect Timeout (ms)"
                                            initialValue={5000}
                                          >
                                            <Input type="number" placeholder="5000" size="middle" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'ackTimeoutMs']}
                                            label="ACK Timeout (ms)"
                                            initialValue={15000}
                                          >
                                            <Input type="number" placeholder="15000" size="middle" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'keepAlive']}
                                            label="Keep connection open"
                                            valuePropName="checked"
                                            tooltip="Reuse the MLLP socket for this target instead of reconnecting for every message."
                                          >
                                            <Switch />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'idleTimeoutMs']}
                                            label="Idle Timeout (ms)"
                                            initialValue={60000}
                                          >
                                            <Input type="number" placeholder="60000" size="middle" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                          <Typography.Text strong>TLS</Typography.Text>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'tls', 'enabled']}
                                            label="Enable TLS"
                                            valuePropName="checked"
                                          >
                                            <Switch />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'tls', 'rejectUnauthorized']}
                                            label="Verify server certificate"
                                            valuePropName="checked"
                                            initialValue={true}
                                          >
                                            <Switch />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'tls', 'caPath']}
                                            label="CA Path"
                                          >
                                            <Input
                                              placeholder="/etc/integration-control-plane/vendor-ca.crt"
                                              size="middle"
                                            />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'tls', 'certPath']}
                                            label="Client Cert Path"
                                          >
                                            <Input
                                              placeholder="/etc/integration-control-plane/client.crt"
                                              size="middle"
                                            />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                          <Form.Item
                                            {...restField}
                                            name={[name, 'hl7Config', 'tls', 'keyPath']}
                                            label="Client Key Path"
                                          >
                                            <Input
                                              placeholder="/etc/integration-control-plane/client.key"
                                              size="middle"
                                            />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                          <Alert
                                            type="info"
                                            message="HL7 MLLP delivery"
                                            description="The transformation script should return an HL7 string or use hl7.ormO01(), hl7.oruR01(), or hl7.adtA08(). Delivery succeeds only when the receiver returns an accepting ACK."
                                            showIcon
                                            style={{
                                              marginBottom: spacingToNumber(spacing[2]),
                                              background: withAlpha(cssVar.info.bg, 0.65),
                                              border: `1px solid ${cssVar.info.border}`,
                                            }}
                                          />
                                        </Col>
                                      </>
                                    );
                                  }

                                  {
                                    /* Provider template toggle */
                                  }
                                  const useProviderRef = form.getFieldValue(['actions', name, 'useProviderRef']);

                                  return (
                                    <>
                                      <Col xs={24}>
                                        <Form.Item
                                          {...restField}
                                          name={[name, 'useProviderRef']}
                                          valuePropName="checked"
                                          label="Use provider template"
                                          tooltip="Use a pre-configured provider operation template (e.g. PartnerHub / fetch-profile) instead of entering the URL and auth manually."
                                          style={{ marginBottom: spacingToNumber(spacing[2]) }}
                                        >
                                          <Switch />
                                        </Form.Item>
                                      </Col>

                                      {useProviderRef ? (
                                        /* ── Provider template fields ── */
                                        <>
                                          <Col xs={24} md={12}>
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'providerRef', 'providerKey']}
                                              label="Provider Key"
                                              tooltip="Identifier for the provider (e.g. partnerhub)"
                                              rules={[{ required: true, message: 'Provider key is required' }]}
                                            >
                                              <Input placeholder="partnerhub" size="middle" />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24} md={12}>
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'providerRef', 'operationKey']}
                                              label="Operation Key"
                                              tooltip="Specific operation on this provider (e.g. fetch-profile)"
                                              rules={[{ required: true, message: 'Operation key is required' }]}
                                            >
                                              <Input placeholder="fetch-profile" size="middle" />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24}>
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'providerRef', 'placeholdersJson']}
                                              label="Placeholders"
                                              tooltip='Key-value pairs injected into the template — e.g. credentials and partner IDs. Enter as JSON object: {"username":"connector","password":"secret"}'
                                              extra="JSON object of {{token}} substitutions defined in the template"
                                              rules={[
                                                {
                                                  validator: (_, v) => {
                                                    if (!v || !String(v).trim()) return Promise.resolve();
                                                    try {
                                                      JSON.parse(v);
                                                      return Promise.resolve();
                                                    } catch {
                                                      return Promise.reject('Must be valid JSON object');
                                                    }
                                                  },
                                                },
                                              ]}
                                            >
                                              <Input.TextArea
                                                rows={3}
                                                placeholder={'{\n  "username": "connector",\n  "password": "secret"\n}'}
                                                size="middle"
                                                style={{ fontFamily: 'monospace', fontSize: 12 }}
                                              />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24}>
                                            <Alert
                                              type="info"
                                              showIcon
                                              message="Template resolution"
                                              description="At delivery time the platform looks up the template, fills placeholder tokens, and merges the result with any fields you override here (e.g. targetUrl, timeoutMs)."
                                              style={{
                                                marginBottom: spacingToNumber(spacing[2]),
                                                background: withAlpha(cssVar.info.bg, 0.6),
                                                border: `1px solid ${cssVar.info.border}`,
                                              }}
                                            />
                                          </Col>
                                        </>
                                      ) : (
                                        /* ── Manual URL / method fields ── */
                                        <>
                                          <Col xs={24} md={12}>
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'httpMethod']}
                                              label="HTTP Method"
                                              initialValue="POST"
                                            >
                                              <Select options={uiConfig?.httpMethods || []} size="middle" />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24} md={12}>
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'targetUrl']}
                                              label="Target URL"
                                              rules={[
                                                { required: true, message: 'Target URL is required for each action' },
                                                {
                                                  pattern: /^https?:\/\/.+/i,
                                                  message: 'Must be a valid HTTP or HTTPS URL',
                                                },
                                              ]}
                                            >
                                              <Input placeholder="https://api.clevertap.com/1/upload" size="middle" />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24}>
                                            <Alert
                                              type="warning"
                                              message="No localhost/private IPs"
                                              description="Localhost and private IP addresses are blocked for HTTP actions. Use publicly accessible URLs only."
                                              showIcon
                                              style={{
                                                marginBottom: spacingToNumber(spacing[2]),
                                                background: withAlpha(cssVar.warning.bg, 0.65),
                                                border: `1px solid ${cssVar.warning.border}`,
                                                color: cssVar.warning.text,
                                              }}
                                            />
                                          </Col>
                                        </>
                                      )}
                                    </>
                                  );
                                }}
                              </Form.Item>

                              <Col xs={24}>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'condition']}
                                  label="Condition (Optional)"
                                  tooltip="When to execute this action"
                                >
                                  <Input placeholder="e.g., eventType === 'PATIENT_REGISTRATION'" size="middle" />
                                </Form.Item>
                              </Col>

                              <Col xs={24}>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'transformationMode']}
                                  label="Transformation Mode"
                                  initialValue="SCRIPT"
                                >
                                  <Select
                                    options={[
                                      { value: 'SIMPLE', label: 'Simple Mapping' },
                                      { value: 'SCRIPT', label: 'JavaScript Script' },
                                    ]}
                                    size="middle"
                                  />
                                </Form.Item>
                              </Col>

                              <Form.Item noStyle shouldUpdate>
                                {() => {
                                  const currentMode = form.getFieldValue(['actions', name, 'transformationMode']);

                                  if (currentMode === 'SCRIPT') {
                                    const scriptValue = form.getFieldValue([
                                      'actions',
                                      name,
                                      'transformation',
                                      'script',
                                    ]);
                                    const inViewMode = !isCreate && !isEditMode;
                                    const displayScript = formatScriptForDisplay(scriptValue);

                                    return (
                                      <Col xs={24}>
                                        {inViewMode && scriptValue ? (
                                          <div style={{ marginBottom: spacingToNumber(spacing[3]) }}>
                                            <Typography.Text
                                              strong
                                              style={{ display: 'block', marginBottom: spacing[2] }}
                                            >
                                              Transformation Script:
                                            </Typography.Text>
                                            <MonacoEditorInput height="260px" value={displayScript} readOnly />
                                          </div>
                                        ) : (
                                          <>
                                            <Collapse
                                              size="small"
                                              ghost
                                              style={{ marginBottom: spacingToNumber(spacing[3]) }}
                                              items={[
                                                {
                                                  key: 'lookup-help',
                                                  label: (
                                                    <Space size={4}>
                                                      <DatabaseOutlined style={{ color: colors.primary[600] }} />
                                                      <Typography.Text strong style={{ fontSize: 13 }}>
                                                        Using Lookup Tables in Scripts
                                                      </Typography.Text>
                                                    </Space>
                                                  ),
                                                  children: (
                                                    <div>
                                                      <Typography.Text style={{ fontSize: 12 }}>
                                                        Use <code>lookup(sourceCode, mappingType)</code> to translate
                                                        codes:
                                                      </Typography.Text>
                                                      <pre
                                                        style={{
                                                          background: cssVar.bg.overlay,
                                                          color: cssVar.text.primary,
                                                          padding: '8px',
                                                          borderRadius: 4,
                                                          fontSize: 11,
                                                          marginTop: 8,
                                                          marginBottom: 8,
                                                        }}
                                                      >
                                                        {`// Simple lookup
externalCode: lookup(payload.code, 'SERVICE_CODE'),

// With fallback
providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN'`}
                                                      </pre>
                                                      <Typography.Link
                                                        href="/help/lookup-guide"
                                                        target="_blank"
                                                        style={{ fontSize: 12 }}
                                                      >
                                                        <BookOutlined style={{ marginRight: 4 }} />
                                                        View Complete Guide
                                                      </Typography.Link>
                                                    </div>
                                                  ),
                                                },
                                              ]}
                                            />
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'transformation', 'script']}
                                              label="Transformation Script"
                                              tooltip="Transform event data"
                                              rules={[{ required: true, message: 'Transformation script is required' }]}
                                            >
                                              <MonacoEditorInput
                                                height="300px"
                                                placeholder={`function transform(payload, context) {\n  return {\n    d: [{\n      identity: payload.recordId,\n      type: 'profile',\n      profileData: { Name: payload.name }\n    }]\n  };\n}`}
                                              />
                                            </Form.Item>
                                          </>
                                        )}
                                      </Col>
                                    );
                                  }

                                  return (
                                    <Col xs={24}>
                                      <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                                        Field Mappings
                                      </Typography.Text>
                                      <Form.List name={[name, 'transformation', 'mappings']}>
                                        {(mappingFields, { add: addMapping, remove: removeMapping }) => (
                                          <>
                                            {mappingFields.map(
                                              ({ key: mappingKey, name: mappingName, ...mappingRest }) => (
                                                <div
                                                  key={mappingKey}
                                                  style={{
                                                    display: 'flex',
                                                    gap: spacingToNumber(spacing[2]),
                                                    marginBottom: spacing[2],
                                                    alignItems: 'center',
                                                    flexWrap: 'wrap',
                                                  }}
                                                >
                                                  <Form.Item
                                                    {...mappingRest}
                                                    name={[mappingName, 'targetField']}
                                                    style={{ marginBottom: 0, flex: '1 1 150px' }}
                                                  >
                                                    <Input placeholder="Target field" size="middle" />
                                                  </Form.Item>
                                                  <ArrowRightOutlined style={{ color: cssVar.text.secondary }} />
                                                  <Form.Item
                                                    {...mappingRest}
                                                    name={[mappingName, 'sourceField']}
                                                    style={{ marginBottom: 0, flex: '1 1 200px' }}
                                                  >
                                                    <Select
                                                      showSearch
                                                      placeholder="Select source field"
                                                      size="middle"
                                                      options={availableFields.map((f) => ({
                                                        label: `${f.label} (${f.path || f.key})`,
                                                        value: f.path || f.key,
                                                      }))}
                                                      filterOption={(input, option) =>
                                                        (option?.label?.toString() ?? '')
                                                          .toLowerCase()
                                                          .includes(input.toLowerCase())
                                                      }
                                                    />
                                                  </Form.Item>
                                                  <Form.Item
                                                    {...mappingRest}
                                                    name={[mappingName, 'transform']}
                                                    initialValue="none"
                                                    style={{ marginBottom: 0, flex: '0 0 120px' }}
                                                  >
                                                    <Select
                                                      size="middle"
                                                      options={[
                                                        { value: 'none', label: 'No transform' },
                                                        { value: 'trim', label: 'Trim' },
                                                        { value: 'upper', label: 'Uppercase' },
                                                        { value: 'lower', label: 'Lowercase' },
                                                        { value: 'lookup', label: 'Lookup' },
                                                      ]}
                                                    />
                                                  </Form.Item>
                                                  <Form.Item noStyle shouldUpdate>
                                                    {() => {
                                                      const transformValue = form.getFieldValue([
                                                        'actions',
                                                        name,
                                                        'transformation',
                                                        'mappings',
                                                        mappingName,
                                                        'transform',
                                                      ]);
                                                      if (transformValue === 'lookup') {
                                                        return (
                                                          <Form.Item
                                                            {...mappingRest}
                                                            name={[mappingName, 'lookupType']}
                                                            style={{
                                                              marginBottom: 0,
                                                              flex: '1 1 200px',
                                                              minWidth: 200,
                                                            }}
                                                            getValueFromEvent={(val) => {
                                                              return Array.isArray(val) && val.length > 0 ? val[0] : '';
                                                            }}
                                                            getValueProps={(val) => {
                                                              return { value: val ? [val] : [] };
                                                            }}
                                                          >
                                                            <Select
                                                              placeholder="Select lookup type"
                                                              size="middle"
                                                              showSearch
                                                              mode="tags"
                                                              maxCount={1}
                                                              tokenSeparators={[',']}
                                                              options={lookupTypes.map((t) => ({ label: t, value: t }))}
                                                              notFoundContent={
                                                                <Typography.Text
                                                                  type="secondary"
                                                                  style={{ color: cssVar.text.secondary }}
                                                                >
                                                                  No lookup types found. Type to create new (e.g.,
                                                                  SERVICE_CODE)
                                                                </Typography.Text>
                                                              }
                                                            />
                                                          </Form.Item>
                                                        );
                                                      }
                                                      return null;
                                                    }}
                                                  </Form.Item>
                                                  <Button
                                                    type="text"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    onClick={() => removeMapping(mappingName)}
                                                  />
                                                </div>
                                              )
                                            )}
                                            <Button
                                              type="dashed"
                                              onClick={() =>
                                                addMapping({ targetField: '', sourceField: '', transform: 'none' })
                                              }
                                              block
                                              size="middle"
                                              icon={<PlusOutlined />}
                                              style={{ marginBottom: spacing[3] }}
                                            >
                                              Add Field Mapping
                                            </Button>
                                          </>
                                        )}
                                      </Form.List>

                                      <Typography.Text
                                        strong
                                        style={{ display: 'block', marginTop: spacing[3], marginBottom: spacing[2] }}
                                      >
                                        Static Fields
                                      </Typography.Text>
                                      <Form.List name={[name, 'transformation', 'staticFields']}>
                                        {(staticFieldsList, { add: addStatic, remove: removeStatic }) => (
                                          <>
                                            {staticFieldsList.map(
                                              ({ key: staticKey, name: staticName, ...staticRest }) => (
                                                <div
                                                  key={staticKey}
                                                  style={{
                                                    display: 'flex',
                                                    gap: spacingToNumber(spacing[2]),
                                                    marginBottom: spacing[2],
                                                    alignItems: 'center',
                                                  }}
                                                >
                                                  <Form.Item
                                                    {...staticRest}
                                                    name={[staticName, 'key']}
                                                    style={{ marginBottom: 0, flex: 1 }}
                                                  >
                                                    <Input placeholder="Key" size="middle" />
                                                  </Form.Item>
                                                  <Form.Item
                                                    {...staticRest}
                                                    name={[staticName, 'value']}
                                                    style={{ marginBottom: 0, flex: 1 }}
                                                  >
                                                    <Input placeholder="Value" size="middle" />
                                                  </Form.Item>
                                                  <Button
                                                    type="text"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    onClick={() => removeStatic(staticName)}
                                                  />
                                                </div>
                                              )
                                            )}
                                            <Button
                                              type="dashed"
                                              onClick={() => addStatic({ key: '', value: '' })}
                                              block
                                              size="middle"
                                              icon={<PlusOutlined />}
                                            >
                                              Add Static Field
                                            </Button>
                                          </>
                                        )}
                                      </Form.List>
                                    </Col>
                                  );
                                }}
                              </Form.Item>

                              <Col xs={24}>
                                <ActionTransformPreview
                                  actionIndex={index}
                                  form={form}
                                  selectedEventTypeData={selectedEventTypeData}
                                  colors={colors}
                                  spacing={spacing}
                                  token={token}
                                />
                              </Col>
                            </Row>
                          </div>
                        ))}

                        <Button
                          type="dashed"
                          onClick={() => add({ name: '', httpMethod: 'POST', transformationMode: 'SCRIPT' })}
                          block
                          size="middle"
                          icon={<PlusOutlined />}
                        >
                          Add Action
                        </Button>

                        <FormAlerts
                          validationErrors={multiActionValidationErrors}
                          spacing={spacing}
                          style={{ marginTop: spacingToNumber(spacing[3]) }}
                        />
                      </>
                    )}
                  </Form.List>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </SectionCard>
  );
};
