import { useMemo, useState } from 'react';
import {
  App,
  Modal,
  Space,
  Input,
  Select,
  Tooltip,
  Divider,
  Collapse,
} from '@/components/common/LegacyAntdControls';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { QuickSetupSection } from '../components/QuickSetupSection';
import { FilterBar } from '../../../components/common/FilterBar';
import { SearchInput } from '../../../components/common/ListControls';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { StatePanel } from '../../../components/common/StatePanel';
import { getTemplates, createIntegrationFromTemplate } from '../../../services/api';
import type { IntegrationTemplate } from '../../../mocks/types';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import { markMorphSource } from '../../../design-system/view-transition';
import { prefetchDetailRoute } from '../../../app/route-prefetch';
import { Button } from '../../../components/common/LegacyButton';
import { ModernTable } from '../../../components/common/ModernTable';

const { TextArea } = Input;

export const TemplatesRoute = () => {
  const navigate = useNavigateWithParams();
  const { spacing, token } = useDesignTokens();
  const {
    data: templates = [],
    isLoading,
    refetch,
  } = useQuery({ queryKey: ['templates'], queryFn: getTemplates, staleTime: 60_000 });

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [selectedTemplate, setSelectedTemplate] = useState<IntegrationTemplate | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [bodyParams, setBodyParams] = useState<Array<{ field: string; default: string }>>([]);
  const { message: msgApi } = App.useApp();

  const categories = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return [...new Set(templates.map((t) => t.category))];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return templates.filter((template) => {
      const matchesSearch =
        !searchTerm ||
        template.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.metadata?.vendor?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !categoryFilter || template.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchTerm, categoryFilter]);

  const handleCreateFromTemplate = async (template: IntegrationTemplate) => {
    setSelectedTemplate(template);
    setCreateModalVisible(true);

    // Initialize overrides with template defaults
    setOverrides({
      name: `${template.name} Integration`,
      targetUrl: template.targetUrl || '',
      httpMethod: template.httpMethod || 'POST',
      timeoutMs: template.timeoutMs || 30000,
      retryCount: template.retryCount !== undefined ? template.retryCount : 3,
      eventType: template.eventType || '',
      scope: 'ENTITY_ONLY',
      outgoingAuthType: template.authType || 'NONE',
      outgoingAuthConfig: template.authConfig || {},
      transformationMode: template.transformationMode || null,
      transformation: template.transformation || {},
      actions: template.actions || null,
    });

    // Initialize placeholder values (empty - user will fill them in)
    const placeholders: Record<string, string> = {};
    if (template.metadata?.placeholders) {
      Object.keys(template.metadata.placeholders).forEach((key) => {
        placeholders[key] = '';
      });
    }
    setPlaceholderValues(placeholders);

    // Initialize body params with default example if BODY_PARAMS placeholder exists
    if (template.metadata?.placeholders?.BODY_PARAMS) {
      // Try to get default from first example
      const firstExample = template.metadata.examples?.[0];
      if (firstExample && (firstExample as any).bodyParams) {
        try {
          const parsedParams = JSON.parse((firstExample as any).bodyParams);
          setBodyParams(parsedParams);
        } catch {
          // Fallback to 3 empty params
          setBodyParams([
            { field: '', default: '' },
            { field: '', default: '' },
            { field: '', default: '' },
          ]);
        }
      } else {
        setBodyParams([
          { field: '', default: '' },
          { field: '', default: '' },
          { field: '', default: '' },
        ]);
      }
    } else {
      setBodyParams([]);
    }
  };

  const handleCreateIntegration = async () => {
    if (!selectedTemplate) return;

    // Validate required fields
    if (!overrides.name?.trim()) {
      msgApi.warning('Please provide a integration name.');
      return;
    }

    // Validate placeholders
    const missingPlaceholders: string[] = [];
    if (selectedTemplate.metadata?.placeholders) {
      Object.keys(selectedTemplate.metadata.placeholders).forEach((key) => {
        // Skip BODY_PARAMS as it's handled separately
        if (key === 'BODY_PARAMS') return;

        if (!placeholderValues[key]?.trim()) {
          missingPlaceholders.push(key);
        }
      });
    }

    // Validate body params if template has BODY_PARAMS
    if (selectedTemplate.metadata?.placeholders?.BODY_PARAMS) {
      if (bodyParams.length === 0) {
        msgApi.warning('Please add at least one body parameter');
        return;
      }

      const invalidParams = bodyParams.some((p) => !p.field?.trim());
      if (invalidParams) {
        msgApi.warning('All body parameters must have a field name');
        return;
      }
    }

    if (missingPlaceholders.length > 0) {
      msgApi.warning(`Please fill in all required placeholders: ${missingPlaceholders.join(', ')}`);
      return;
    }

    // Validate URL if not using placeholder
    const urlPattern = /^https?:\/\/.+/i;
    if (overrides.targetUrl && !overrides.targetUrl.includes('{{') && !urlPattern.test(overrides.targetUrl)) {
      msgApi.warning('Enter a valid HTTP/HTTPS target URL.');
      return;
    }

    if (overrides.timeoutMs && (overrides.timeoutMs < 500 || overrides.timeoutMs > 60000)) {
      msgApi.warning('Timeout must be between 500 and 60000 ms.');
      return;
    }

    if (overrides.retryCount !== undefined && (overrides.retryCount < 0 || overrides.retryCount > 10)) {
      msgApi.warning('Retry count must be between 0 and 10.');
      return;
    }

    try {
      setCreateLoading(true);

      // Prepare placeholders with BODY_PARAMS serialization if needed
      const finalPlaceholders = { ...placeholderValues };

      // If template has BODY_PARAMS placeholder, serialize the bodyParams array
      if (selectedTemplate.metadata?.placeholders?.BODY_PARAMS) {
        finalPlaceholders.BODY_PARAMS = JSON.stringify(bodyParams);
      }

      // Prepare payload with placeholders
      const payload = {
        templateId: selectedTemplate.id,
        overrides: {
          ...overrides,
          placeholders: finalPlaceholders,
        },
      };

      const integration = await createIntegrationFromTemplate(payload);

      msgApi.success('Integration created successfully from template');
      setCreateModalVisible(false);
      setSelectedTemplate(null);
      setOverrides({});
      setPlaceholderValues({});
      setBodyParams([]);
      navigate(`/integrations/${integration.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      msgApi.error(`Failed to create event rule: ${errorMessage}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const templateColumns = [
    {
      title: 'Template',
      dataIndex: 'name',
      key: 'name',
      width: 360,
      render: (_: string, template: IntegrationTemplate) => (
        <Space direction="vertical" size={2}>
          <strong>{template.name}</strong>
          <AstryxText type="supporting" color="secondary">
            {template.description}
          </AstryxText>
          {template.metadata?.vendor && (
            <AstryxText type="supporting" color="secondary">
              {template.metadata.vendor}
            </AstryxText>
          )}
        </Space>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 150,
      render: (_: string, template: IntegrationTemplate) => (
        <StatusBadge label={template.category} variant="info" showIcon={false} />
      ),
    },
    {
      title: 'Event',
      dataIndex: 'eventType',
      key: 'eventType',
      width: 190,
      render: (eventType: string | undefined) =>
        eventType ? <code className="console-font-mono console-type-body">{eventType}</code> : '—',
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'status',
      width: 120,
      render: (isActive: boolean) => (isActive ? <StatusBadge label="Active" variant="success" /> : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_: unknown, template: IntegrationTemplate) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            aria-label={`Edit ${template.name}`}
            onMouseEnter={() => prefetchDetailRoute('template')}
            onFocus={() => prefetchDetailRoute('template')}
            onClick={(event) => {
              markMorphSource(event.currentTarget.closest('tr')?.querySelector<HTMLElement>('strong') ?? null);
              navigate(`/templates/${template.id}`, { state: { title: template.name } });
            }}
          >
            Edit
          </Button>
          <Button
            type="primary"
            size="small"
            aria-label={`Use ${template.name}`}
            onClick={() => handleCreateFromTemplate(template)}
          >
            Use template
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageTemplate
      className="templates-list-template"
      header={
        <PageHeader
          title="Templates"
          description="Connect a common service in one step, or start from your organization's own templates."
          compact
          actions={
            <Space>
              <Button size="middle" onClick={() => refetch()}>
                Refresh Templates
              </Button>
              <Button
                type="primary"
                size="middle"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => navigate('/templates/new')}
              >
                Create Template
              </Button>
            </Space>
          }
        />
      }
    >
      <QuickSetupSection />

      <FilterBar
        rightSlot={
          <Space>
            <AstryxText type="supporting" color="secondary">
              {filteredTemplates.length} of {templates.length} templates
            </AstryxText>
            <Button
              icon={<GatewayIcon name="FilterOutlined" />}
              type="text"
              onClick={() => {
                setSearchTerm('');
                setCategoryFilter(undefined);
              }}
            >
              Reset
            </Button>
          </Space>
        }
      >
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          label="Search templates"
          placeholder="Search templates..."
          width={250}
        />
        <Select
          aria-label="Filter templates by category"
          placeholder="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          className="template-category-filter"
          allowClear
          options={categories.map((cat) => ({ value: cat, label: cat }))}
        />
      </FilterBar>

      <div className="console-padding-y-3">
        {filteredTemplates.length === 0 ? (
          <StatePanel
            size="compact"
            glyph="searching"
            title={templates.length === 0 ? 'No templates available' : 'No matching templates'}
            description={templates.length === 0 ? undefined : 'Adjust the search or category filter.'}
          />
        ) : (
          <ModernTable
            columns={templateColumns}
            dataSource={filteredTemplates}
            rowKey="id"
            pagination={false}
            size="small"
          />
        )}
      </div>

      {/* Create Integration from Template Modal */}
      <Modal
        title={`Create Event Rule from: ${selectedTemplate?.name}`}
        open={createModalVisible}
        onOk={handleCreateIntegration}
        onCancel={() => {
          setCreateModalVisible(false);
          setSelectedTemplate(null);
          setOverrides({});
          setPlaceholderValues({});
          setBodyParams([]);
        }}
        confirmLoading={createLoading}
        width={700}
      >
        {selectedTemplate && (
          <Space direction="vertical" size="middle" className="console-width-full">
            {/* Template Information */}
            <div>
              <AstryxText weight="semibold">Template Information</AstryxText>
              <div className="console-margin-top-2">
                <AstryxText as="p" display="block">
                  {selectedTemplate.description}
                </AstryxText>
                <Space wrap>
                  <StatusBadge label={selectedTemplate.category} variant="info" showIcon={false} />
                  {selectedTemplate.metadata?.vendor && (
                    <AstryxText type="supporting" color="secondary">
                      {selectedTemplate.metadata.vendor}
                    </AstryxText>
                  )}
                  {selectedTemplate.transformationMode && (
                    <AstryxText type="code">
                      <GatewayIcon name="CodeOutlined" aria-hidden="true" /> {selectedTemplate.transformationMode}
                    </AstryxText>
                  )}
                  {selectedTemplate.actions && selectedTemplate.actions.length > 0 && (
                    <AstryxText type="supporting" color="secondary">
                      {selectedTemplate.actions.length} actions
                    </AstryxText>
                  )}
                </Space>
                {selectedTemplate.metadata?.documentation && (
                  <div className="console-margin-top-2">
                    <AstryxText type="supporting" color="secondary">
                      <GatewayIcon name="InfoCircleOutlined" />{' '}
                      <a href={selectedTemplate.metadata.documentation} target="_blank" rel="noopener noreferrer">
                        View Documentation
                      </a>
                    </AstryxText>
                  </div>
                )}
              </div>
            </div>

            <Divider className="console-margin-y-2" />

            {/* Placeholder Configuration */}
            {selectedTemplate.metadata?.placeholders &&
              Object.keys(selectedTemplate.metadata.placeholders).length > 0 && (
                <>
                  <div>
                    <AstryxText weight="semibold">Template Placeholders *</AstryxText>
                    <AstryxText
                      type="supporting"
                      color="secondary"
                      className="console-display-block console-margin-top-1 console-margin-bottom-2"
                    >
                      Fill in the required values below to customize this template.
                    </AstryxText>
                    <Space direction="vertical" size="small" className="console-width-full">
                      {Object.entries(selectedTemplate.metadata.placeholders).map(([key, description]) => {
                        // Special handling for BODY_PARAMS - render dynamic parameter builder
                        if (key === 'BODY_PARAMS') {
                          return (
                            <div key={key}>
                              <div className="template-body-params-heading">
                                <AstryxText weight="semibold">Body Parameters *</AstryxText>
                                <Button
                                  type="dashed"
                                  size="small"
                                  icon={<GatewayIcon name="PlusCircleOutlined" />}
                                  onClick={() => setBodyParams([...bodyParams, { field: '', default: '' }])}
                                >
                                  Add Parameter
                                </Button>
                              </div>
                              <AstryxText
                                type="supporting"
                                color="secondary"
                                className="console-type-caption console-display-block console-margin-bottom-2"
                              >
                                {description as string}
                              </AstryxText>
                              <Space direction="vertical" size="small" className="console-width-full">
                                {bodyParams.map((param, idx) => (
                                  <div key={idx} className="template-body-param-row">
                                    <div className="console-flex-fill">
                                      <AstryxText className="console-caption-secondary">Field Name</AstryxText>
                                      <Input
                                        size="small"
                                        value={param.field}
                                        onChange={(e) => {
                                          const newParams = [...bodyParams];
                                          newParams[idx].field = e.target.value;
                                          setBodyParams(newParams);
                                        }}
                                        placeholder="e.g., name"
                                      />
                                    </div>
                                    <div className="console-flex-fill">
                                      <AstryxText className="console-caption-secondary">Default Value</AstryxText>
                                      <Input
                                        size="small"
                                        value={param.default}
                                        onChange={(e) => {
                                          const newParams = [...bodyParams];
                                          newParams[idx].default = e.target.value;
                                          setBodyParams(newParams);
                                        }}
                                        placeholder="e.g., Guest"
                                      />
                                    </div>
                                    <Button
                                      type="text"
                                      danger
                                      size="small"
                                      icon={<GatewayIcon name="DeleteOutlined" />}
                                      onClick={() => {
                                        const newParams = bodyParams.filter((_, i) => i !== idx);
                                        setBodyParams(newParams);
                                      }}
                                      className="ui-extracted-d495312882"
                                    />
                                  </div>
                                ))}
                              </Space>
                            </div>
                          );
                        }

                        // Regular placeholder input
                        return (
                          <div key={key}>
                            <AstryxText>{key} *</AstryxText>
                            <Tooltip title={description}>
                              <Input
                                value={placeholderValues[key] || ''}
                                onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={description as string}
                                suffix={<GatewayIcon name="InfoCircleOutlined" className="console-text-muted" />}
                              />
                            </Tooltip>
                          </div>
                        );
                      })}
                    </Space>
                  </div>
                  <Divider className="console-margin-y-2" />
                </>
              )}

            {/* Basic Configuration */}
            <div>
              <AstryxText weight="semibold">Integration Configuration</AstryxText>
              <Space direction="vertical" size="small" className="console-width-full-margin-top-2">
                <div>
                  <AstryxText>Integration Name *</AstryxText>
                  <Input
                    value={overrides.name}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter event rule name"
                  />
                </div>

                <div>
                  <AstryxText>Event Type</AstryxText>
                  <Input
                    value={overrides.eventType}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, eventType: e.target.value }))}
                    placeholder={selectedTemplate.eventType || 'Enter event type or use * for all events'}
                    disabled={!!selectedTemplate.metadata?.placeholders?.EVENT_TYPE}
                  />
                  {selectedTemplate.metadata?.placeholders?.EVENT_TYPE && (
                    <AstryxText type="supporting" color="secondary" className="console-type-caption">
                      This will be set from the EVENT_TYPE placeholder above
                    </AstryxText>
                  )}
                </div>

                <div>
                  <Space className="console-width-full">
                    <div className="console-flex-fill">
                      <AstryxText>Timeout (ms)</AstryxText>
                      <Input
                        type="number"
                        value={overrides.timeoutMs}
                        onChange={(e) =>
                          setOverrides((prev) => ({ ...prev, timeoutMs: parseInt(e.target.value) || 30000 }))
                        }
                        min="1000"
                        max="60000"
                      />
                    </div>
                    <div className="console-flex-fill">
                      <AstryxText>Retry Count</AstryxText>
                      <Input
                        type="number"
                        value={overrides.retryCount}
                        onChange={(e) =>
                          setOverrides((prev) => ({ ...prev, retryCount: parseInt(e.target.value) || 3 }))
                        }
                        min="0"
                        max="10"
                      />
                    </div>
                  </Space>
                </div>
              </Space>
            </div>

            {/* Advanced Details (Collapsible) */}
            <Collapse
              items={[
                {
                  key: 'advanced',
                  label: 'Advanced Details',
                  children: (
                    <Space direction="vertical" size="small" className="console-width-full">
                      {/* Multi-Action Display */}
                      {selectedTemplate.actions && selectedTemplate.actions.length > 0 && (
                        <div>
                          <AstryxText weight="semibold">Actions ({selectedTemplate.actions.length})</AstryxText>
                          {selectedTemplate.actions.map((action, idx) => (
                            <div
                              key={idx}
                              style={{
                                marginTop: spacing[2],
                                padding: spacing[2],
                                background: cssVar.bg.subtle,
                                borderRadius: token.borderRadius,
                              }}
                            >
                              <AstryxText weight="semibold">
                                {idx + 1}. {action.name}
                              </AstryxText>
                              {action.condition && (
                                <div className="console-margin-top-1">
                                  <AstryxText type="supporting" color="secondary" className="console-type-caption">
                                    Condition: <code>{action.condition}</code>
                                  </AstryxText>
                                </div>
                              )}
                              {action.transformationMode && (
                                <div className="console-margin-top-1">
                                  <AstryxText type="supporting" color="secondary">
                                    <GatewayIcon name="CodeOutlined" aria-hidden="true" /> {action.transformationMode}
                                  </AstryxText>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Transformation Script Preview */}
                      {selectedTemplate.transformationMode === 'SCRIPT' && selectedTemplate.transformation?.script && (
                        <div>
                          <AstryxText weight="semibold">Transformation Script</AstryxText>
                          <TextArea
                            value={selectedTemplate.transformation.script}
                            readOnly
                            rows={6}
                            style={{
                              marginTop: spacing[1],
                              fontFamily: 'monospace',
                              fontSize: 'var(--console-type-caption)',
                              background: cssVar.table.codeBg,
                            }}
                          />
                        </div>
                      )}

                      {/* Examples */}
                      {selectedTemplate.metadata?.examples && selectedTemplate.metadata.examples.length > 0 && (
                        <div>
                          <AstryxText weight="semibold">Usage Examples</AstryxText>
                          {selectedTemplate.metadata.examples.map((example, idx) => (
                            <div
                              key={idx}
                              style={{
                                marginTop: spacing[1],
                                padding: spacing[2],
                                background: cssVar.bg.subtle,
                                borderRadius: token.borderRadius,
                              }}
                            >
                              <AstryxText>{example.name}</AstryxText>
                              {example.eventType && (
                                <div>
                                  <AstryxText type="supporting" color="secondary" className="console-type-caption">
                                    Event: {example.eventType}
                                  </AstryxText>
                                </div>
                              )}
                              {example.params && (
                                <div>
                                  <AstryxText type="supporting" color="secondary" className="console-type-caption">
                                    Params: {example.params.join(', ')}
                                  </AstryxText>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Modal>
    </PageTemplate>
  );
};
