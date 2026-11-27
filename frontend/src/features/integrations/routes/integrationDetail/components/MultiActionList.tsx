import { Col, Collapse, Form, Input, Row, Select, Space, Switch } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import type { FormInstance } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { spacingToNumber } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { ActionTransformPreview } from '../../../components/detail/ActionTransformPreview';
import { FormAlerts } from '../../../components/common';
import { SectionCard } from './SectionCard';
import { getLookupTypes } from '../../../../../services/api';
import { Button } from '../../../../../components/common/LegacyButton';

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
      icon={<GatewayIcon name="BranchesOutlined" />}
      title="Multi-Action Configuration"
      description="Configure multiple sequential API calls for a single event (e.g., CleverTap profile + event upload)"
      spacing={spacing}
      token={token}
    >
      <Collapse
        defaultActiveKey={isMultiAction || existingActionsCount > 0 ? ['actions'] : []}
        expandIconPosition="end"
        className="multi-action-collapse"
        items={[
          {
            key: 'actions',
            label: (
              <div className="console-flex-center-gap-2">
                <Text size="base" weight="semibold">
                  Multi-Action Configuration
                </Text>
                {isMultiAction && (
                  <Text type="supporting" color="secondary">
                    {actionsCount} action{actionsCount !== 1 ? 's' : ''}
                  </Text>
                )}
              </div>
            ),
            children: (
              <Row gutter={[spacingToNumber(spacing[4]), 0]}>
                <Col xs={24}>
                  <Space direction="vertical" size="small">
                    <Text type="supporting" size="sm" color="secondary" display="block">
                      Multi-Action Mode: Execute multiple HTTP or HL7 MLLP deliveries per event. Actions run sequentially.
                    </Text>
                    <Space size="small">
                      <Button type="primary" size="small" onClick={loadCleverTapTemplate}>
                        Load CleverTap Template
                      </Button>
                      <Text type="supporting" size="sm" color="secondary">
                        Pre-configured example
                      </Text>
                    </Space>
                  </Space>
                </Col>

                <Col xs={24}>
                  <Form.List name="actions">
                    {(fields, { add, remove, move }) => (
                      <>
                        {fields.length === 0 && (
                          <Space direction="vertical" size="small">
                            <Text type="supporting" size="sm" color="secondary" display="block">
                              No actions configured yet. Add your first action to define the target URL, method, and
                              transformation.
                            </Text>
                            <Button
                              type="primary"
                              size="small"
                              icon={<GatewayIcon name="PlusOutlined" />}
                              onClick={() =>
                                add({ kind: 'HTTP', name: '', httpMethod: 'POST', transformationMode: 'SCRIPT' })
                              }
                            >
                              Add Action
                            </Button>
                          </Space>
                        )}
                        {fields.map(({ key, name, ...restField }, index) => (
                          <div
                            key={key}
                            className="multi-action-card"
                          >
                            <Row gutter={[spacingToNumber(spacing[3]), 0]}>
                              <Col xs={24}>
                                <div
                                  className="multi-action-card-header"
                                >
                                  <Text size="base" weight="semibold">
                                    Action {index + 1}
                                  </Text>
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
                                      icon={<GatewayIcon name="DeleteOutlined" />}
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
                                          <Text weight="semibold">TLS</Text>
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
                                          <Text type="supporting" size="sm" color="secondary" display="block">
                                            HL7 MLLP delivery: The transformation script should return an HL7 string or use
                                            hl7.ormO01(), hl7.oruR01(), or hl7.adtA08(). Delivery succeeds only when the
                                            receiver returns an accepting ACK.
                                          </Text>
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
                                          className="console-margin-bottom-2"
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
                                                className="console-font-mono console-type-caption"
                                              />
                                            </Form.Item>
                                          </Col>
                                          <Col xs={24}>
                                            <Text type="supporting" size="sm" color="secondary" display="block">
                                              Template resolution: At delivery time the platform looks up the template, fills
                                              placeholder tokens, and merges the result with any fields you override here
                                              (e.g. targetUrl, timeoutMs).
                                            </Text>
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
                                            <Text type="supporting" size="sm" color="secondary" display="block">
                                              No localhost/private IPs: Localhost and private IP addresses are blocked for
                                              HTTP actions. Use publicly accessible URLs only.
                                            </Text>
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

                              {/* A transformation is a script: the mode is kept only so the saved action says so. */}
                              <Form.Item
                                {...restField}
                                name={[name, 'transformationMode']}
                                initialValue="SCRIPT"
                                hidden
                              >
                                <Input />
                              </Form.Item>

                              <Form.Item noStyle shouldUpdate>
                                {() => {
                                  const scriptValue = form.getFieldValue(['actions', name, 'transformation', 'script']);
                                  const inViewMode = !isCreate && !isEditMode;
                                  const displayScript = formatScriptForDisplay(scriptValue);

                                  return (
                                    <Col xs={24}>
                                      {inViewMode && scriptValue ? (
                                        <div className="console-margin-bottom-3">
                                          <Text weight="semibold" display="block" className="console-margin-bottom-2">
                                            Transformation Script:
                                          </Text>
                                          <MonacoEditorInput height="260px" value={displayScript} readOnly />
                                        </div>
                                      ) : (
                                        <>
                                          <Collapse
                                            size="small"
                                            ghost
                                            className="console-margin-bottom-3"
                                            items={[
                                              {
                                                key: 'lookup-help',
                                                label: (
                                                  <Space size={4}>
                                                    <GatewayIcon
                                                      name="DatabaseOutlined"
                                                      className="console-text-accent"
                                                    />
                                                    <Text size="base" weight="semibold">
                                                      Using Lookup Tables in Scripts
                                                    </Text>
                                                  </Space>
                                                ),
                                                children: (
                                                  <div>
                                                    <Text type="supporting" size="sm">
                                                      Use <code>lookup(sourceCode, mappingType)</code> to translate
                                                      codes:
                                                    </Text>
                                                    <pre className="multi-action-lookup-example">
                                                      {`// Simple lookup
externalCode: lookup(payload.code, 'SERVICE_CODE'),

// With fallback
providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN'`}
                                                    </pre>
                                                    <a href="/help/lookup-guide" target="_blank" rel="noreferrer">
                                                      <GatewayIcon
                                                        name="BookOutlined"
                                                        className="console-margin-right-1"
                                                      />
                                                      View Complete Guide
                                                    </a>
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
                                }}
                              </Form.Item>

                              <Col xs={24}>
                                <ActionTransformPreview
                                  actionIndex={index}
                                  form={form}
                                  selectedEventTypeData={selectedEventTypeData}
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
                          icon={<GatewayIcon name="PlusOutlined" />}
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
