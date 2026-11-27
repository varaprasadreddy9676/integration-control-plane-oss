import { useEffect, useMemo, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import {
  App,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Divider,
  Collapse,
} from '@/components/common/LegacyAntdControls';
import { Panel } from '../../../design-system/primitives';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonacoEditorInput } from '../../integrations/components/MonacoEditorInput';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { getTemplateById, createTemplate, updateTemplate } from '../../../services/api';
import { useDesignTokens, spacingToNumber, withAlpha, cssVar } from '../../../design-system/utils';
import { Button } from '../../../components/common/LegacyButton';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { FormItemSelect } from '../../../shared/forms/FormItemControls';

const { TextArea } = Input;

const CATEGORIES = ['EHR', 'PMS', 'BILLING', 'LAB', 'IMAGING', 'OTHER'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'OAUTH'];

const DEFAULT_EVENT_TYPES = [
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
  'PATIENT_DELETED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_UPDATED',
  'APPOINTMENT_CANCELLED',
  'BILL_CREATED',
  'BILL_UPDATED',
  'PAYMENT_RECEIVED',
  'LAB_RESULT_AVAILABLE',
  'PRESCRIPTION_CREATED',
  'CLINICAL_NOTE_ADDED',
];

const DEFAULT_SCRIPT = `// Transform integration payload
function transform(payload, context) {
  return {
    eventType: context.eventType,
    timestamp: new Date().toISOString(),
    data: payload
  };
}`;

export const TemplateDetailRoute = () => {
  // The name the list passed along, shown until the record loads (title morph target).
  const passedTitle = (useLocation().state as { title?: string } | null)?.title;
  const { id } = useParams();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [form] = Form.useForm();
  const isCreate = !id || id === 'new';

  const [headersJson, setHeadersJson] = useState('{}');
  const [authConfigJson, setAuthConfigJson] = useState('{}');
  const [metadataJson, setMetadataJson] = useState('{}');
  const [transformScript, setTransformScript] = useState(DEFAULT_SCRIPT);
  const [isSaving, setIsSaving] = useState(false);

  const { data: template, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => (id && id !== 'new' ? getTemplateById(id) : Promise.resolve(null)),
    enabled: Boolean(id && id !== 'new'),
  });

  useEffect(() => {
    if (template) {
      form.setFieldsValue({
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType || [],
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        timeoutMs: template.timeoutMs || 10000,
        retryCount: template.retryCount || 3,
        isActive: template.isActive !== false,
      });

      if (template.headers) {
        setHeadersJson(JSON.stringify(template.headers, null, 2));
      }
      if (template.authConfig) {
        setAuthConfigJson(JSON.stringify(template.authConfig, null, 2));
      }
      if (template.metadata) {
        setMetadataJson(JSON.stringify(template.metadata, null, 2));
      }
      if (template.transformation?.script) {
        setTransformScript(template.transformation.script);
      }
    }
  }, [template, form]);

  const handleSubmit = async (values: any) => {
    setIsSaving(true);
    try {
      // Parse JSON fields
      let headers = {};
      let authConfig = {};
      let metadata = {};

      try {
        headers = JSON.parse(headersJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Headers field');
        return;
      }

      try {
        authConfig = JSON.parse(authConfigJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Auth Config field');
        return;
      }

      try {
        metadata = JSON.parse(metadataJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Metadata field');
        return;
      }

      const templateData = {
        name: values.name,
        description: values.description,
        category: values.category,
        eventType: values.eventType,
        targetUrl: values.targetUrl,
        httpMethod: values.httpMethod,
        authType: values.authType,
        authConfig,
        headers,
        timeoutMs: values.timeoutMs,
        retryCount: values.retryCount,
        transformationMode: transformScript && transformScript.trim() ? 'SCRIPT' : 'NONE',
        transformation: {
          mode: transformScript && transformScript.trim() ? 'SCRIPT' : 'NONE',
          script: transformScript,
        },
        isActive: values.isActive,
        metadata,
      };

      if (isCreate) {
        await createTemplate(templateData);
        msgApi.success('Template created successfully');
      } else {
        await updateTemplate(id!, templateData);
        msgApi.success('Template updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['templates'] });
      navigate('/templates');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
      msgApi.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageTemplate
      header={
        <PageHeader
          title={isCreate ? 'Create Template' : template?.name || passedTitle || 'Edit Template'}
          morphTitle={!isCreate}
          description="Define a reusable event rule template for common integrations"
          breadcrumb={[{ label: 'Templates', path: '/templates' }, { label: isCreate ? 'Create' : 'Edit' }]}
          compact
          actions={
            <Space>
              <Button
                size="middle"
                icon={<GatewayIcon name="ArrowLeftOutlined" />}
                onClick={() => navigate('/templates')}
              >
                Back to Templates
              </Button>
              <Button
                type="primary"
                size="middle"
                icon={<GatewayIcon name="SaveOutlined" />}
                onClick={() => form.submit()}
                loading={isSaving}
              >
                {isCreate ? 'Create Template' : 'Save Changes'}
              </Button>
            </Space>
          }
        />
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          httpMethod: 'POST',
          authType: 'API_KEY',
          timeoutMs: 10000,
          retryCount: 3,
          isActive: true,
          eventTypes: [],
        }}
      >
        <Row gutter={[spacingToNumber(spacing[4]), spacingToNumber(spacing[4])]}>
          {/* Left Column */}
          <Col xs={24} lg={12}>
            <Panel title="Basic Information" className="panel">
              <Form.Item
                label="Template Name"
                name="name"
                rules={[{ required: true, message: 'Template name is required' }]}
              >
                <Input placeholder="e.g., Epic EHR Integration" />
              </Form.Item>

              <Form.Item
                label="Description"
                name="description"
                rules={[{ required: true, message: 'Description is required' }]}
              >
                <TextArea rows={3} placeholder="Describe the purpose of this template..." />
              </Form.Item>

              <Row gutter={spacingToNumber(spacing[4])}>
                <Col span={12}>
                  <Form.Item
                    label="Category"
                    name="category"
                    rules={[{ required: true, message: 'Category is required' }]}
                  >
                    <FormItemSelect placeholder="Select category">
                      {CATEGORIES.map((cat) => (
                        <Select.Option key={cat} value={cat}>
                          {cat}
                        </Select.Option>
                      ))}
                    </FormItemSelect>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Active" name="isActive" valuePropName="checked">
                    <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                label="Event Types"
                name="eventType"
                rules={[{ required: true, message: 'At least one event type is required' }]}
              >
                <FormItemSelect mode="multiple" placeholder="Select event types" allowClear showSearch>
                  {DEFAULT_EVENT_TYPES.map((event) => (
                    <Select.Option key={event} value={event}>
                      {event}
                    </Select.Option>
                  ))}
                </FormItemSelect>
              </Form.Item>
            </Panel>

            <Panel title="HTTP Configuration" className="panel" style={{ marginTop: spacing[3] }}>
              <Form.Item
                label="Target URL"
                name="targetUrl"
                validateTrigger="onBlur"
                rules={[
                  { required: true, message: 'Target URL is required' },
                  { type: 'url', message: 'Must be a valid URL' },
                ]}
              >
                <Input placeholder="https://api.example.com/integration" />
              </Form.Item>

              <Row gutter={spacingToNumber(spacing[4])}>
                <Col span={12}>
                  <Form.Item
                    label="HTTP Method"
                    name="httpMethod"
                    rules={[{ required: true, message: 'HTTP method is required' }]}
                  >
                    <FormItemSelect>
                      {HTTP_METHODS.map((method) => (
                        <Select.Option key={method} value={method}>
                          {method}
                        </Select.Option>
                      ))}
                    </FormItemSelect>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="Timeout (ms)"
                    name="timeoutMs"
                    rules={[{ required: true, message: 'Timeout is required' }]}
                  >
                    <InputNumber min={1000} max={60000} step={1000} className="console-width-full" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Retry Count" name="retryCount">
                <InputNumber min={0} max={10} className="console-width-full" />
              </Form.Item>

              <Form.Item label="Custom Headers (JSON)">
                <TextArea
                  rows={4}
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  placeholder={'{\n  "Content-Type": "application/json"\n}'}
                  className="console-font-mono"
                />
                <AstryxText type="supporting" color="secondary" size="sm">
                  JSON object with custom HTTP headers
                </AstryxText>
              </Form.Item>
            </Panel>
          </Col>

          {/* Right Column */}
          <Col xs={24} lg={12}>
            <Panel title="Authentication" className="panel">
              <Form.Item
                label="Authentication Type"
                name="authType"
                rules={[{ required: true, message: 'Auth type is required' }]}
              >
                <FormItemSelect>
                  {AUTH_TYPES.map((type) => (
                    <Select.Option key={type} value={type}>
                      {type}
                    </Select.Option>
                  ))}
                </FormItemSelect>
              </Form.Item>

              <Form.Item label="Auth Configuration (JSON)">
                <TextArea
                  rows={6}
                  value={authConfigJson}
                  onChange={(e) => setAuthConfigJson(e.target.value)}
                  placeholder={'{\n  "apiKey": "your-key",\n  "headerName": "X-API-Key"\n}'}
                  className="console-font-mono"
                />
                <AstryxText type="supporting" color="secondary" size="sm">
                  Configuration depends on auth type (apiKey, token, username/password, etc.)
                </AstryxText>
              </Form.Item>
            </Panel>

            <Panel title="Transformation" className="panel" style={{ marginTop: spacing[3] }}>
              <Form.Item label="Transformation Script">
                <AstryxText
                  as="p"
                  display="block"
                  type="supporting"
                  color="secondary"
                  size="sm"
                  className="console-margin-bottom-3"
                >
                  Editor shortcuts: Cmd/Ctrl+F find, Cmd/Ctrl+H replace, Cmd/Ctrl+/ toggle comment, Cmd/Ctrl+D select
                  next occurrence.
                </AstryxText>
                <Collapse
                  size="small"
                  ghost
                  className="console-margin-bottom-3"
                  items={[
                    {
                      key: 'lookup-help',
                      label: (
                        <Space size={4}>
                          <GatewayIcon name="DatabaseOutlined" className="console-text-accent" />
                          <AstryxText weight="semibold" size="base">
                            Using Lookup Tables in Scripts
                          </AstryxText>
                        </Space>
                      ),
                      children: (
                        <div>
                          <AstryxText type="supporting" size="sm">
                            Use <code>lookup(sourceCode, mappingType)</code> to translate codes using your configured
                            lookup tables:
                          </AstryxText>
                          <pre
                            style={{
                              background: cssVar.table.codeBg,
                              color: cssVar.text.primary,
                              padding: 'var(--spacing-2)',
                              borderRadius: 4,
                              fontSize: 'var(--console-type-caption)',
                              marginTop: 'var(--spacing-2)',
                              marginBottom: 'var(--spacing-2)',
                            }}
                          >
                            {`// Simple lookup
externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),

// With fallback
providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN',

// Array mapping
items: payload.items?.map(item => ({
  ...item,
  externalCode: lookup(item.code, 'ITEM_CODE')
}))`}
                          </pre>
                          <a href="/help/lookup-guide" target="_blank" rel="noreferrer">
                            <GatewayIcon name="BookOutlined" className="console-margin-right-1" />
                            View Complete Lookup Tables Guide
                          </a>
                        </div>
                      ),
                    },
                  ]}
                />
                <div className="console-margin-bottom-2">
                  <MonacoEditorInput value={transformScript} onChange={setTransformScript} height="400px" />
                </div>
                <AstryxText type="supporting" color="secondary" size="sm">
                  JavaScript function to transform integration payloads
                </AstryxText>
              </Form.Item>
            </Panel>

            <Panel title="Metadata (Optional)" className="panel" style={{ marginTop: spacing[6] }}>
              <Form.Item label="Template Metadata (JSON)">
                <TextArea
                  rows={6}
                  value={metadataJson}
                  onChange={(e) => setMetadataJson(e.target.value)}
                  placeholder={'{\n  "vendor": "Epic Systems",\n  "documentation": "https://..."\n}'}
                  className="console-font-mono"
                />
                <AstryxText type="supporting" color="secondary" size="sm">
                  Additional metadata like vendor, documentation links, format, etc.
                </AstryxText>
              </Form.Item>
            </Panel>
          </Col>
        </Row>
      </Form>
    </PageTemplate>
  );
};
