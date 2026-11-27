import { useEffect, useState } from 'react';
import { App, Form, Input, Select, Space, Switch } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from "../../../components/common/Icon";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { getLookup, createLookup, updateLookup, getLookupTypes } from '../../../services/api';
import { useTenant } from '../../../app/tenant-context';
import type { Lookup } from '../../../mocks/types';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { ConfigSection } from '../../../components/common/ConfigSection';
import { StatePanel } from '../../../components/common/StatePanel';
import { FormItemSelect } from '../../../shared/forms/FormItemControls';
import { Button } from '../../../components/common/LegacyButton';

export const LookupDetailRoute = () => {
  const { id } = useParams<{ id: string }>();
  const isEditMode = id !== 'new';
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { tenant, orgId } = useTenant();
  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);

  const { data: lookup, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lookup', orgId, id],
    queryFn: () => getLookup(id!),
    enabled: isEditMode && orgId > 0,
    staleTime: 30_000,
  });

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types', orgId],
    queryFn: getLookupTypes,
    staleTime: 5 * 60 * 1000,
  });

  const types = typesData?.types || [];

  useEffect(() => {
    if (lookup && isEditMode) {
      form.setFieldsValue({
        type: [lookup.type], // Wrap in array for tags mode
        sourceId: lookup.source.id,
        sourceLabel: lookup.source.label,
        targetId: lookup.target.id,
        targetLabel: lookup.target.label,
        orgUnitRid: lookup.orgUnitRid ?? 'parent',
        isActive: lookup.isActive,
      });
    } else if (!isEditMode) {
      // Set defaults for new lookup
      form.setFieldsValue({
        isActive: true,
        orgUnitRid: 'parent',
      });
    }
  }, [lookup, isEditMode, form]);

  const onFinish = async (values: any) => {
    setIsSaving(true);

    try {
      // Extract type from array (tags mode returns array)
      const typeValue = Array.isArray(values.type) ? values.type[0] : values.type;

      const lookupData: Partial<Lookup> = {
        type: typeValue,
        source: {
          id: values.sourceId,
          label: values.sourceLabel || undefined,
        },
        target: {
          id: values.targetId,
          label: values.targetLabel || undefined,
        },
      orgUnitRid: values.orgUnitRid === 'parent' || values.orgUnitRid === undefined ? null : Number(values.orgUnitRid),
        isActive: values.isActive,
      };

      if (isEditMode) {
        await updateLookup(id!, lookupData);
        msgApi.success('Lookup mapping updated successfully');
      } else {
        await createLookup(lookupData);
        msgApi.success('Lookup mapping created successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['lookups'] });
      queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
      navigate('/lookups');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save lookup mapping';
      msgApi.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageTemplate
      className="lookup-editor-workspace"
      header={
        <PageHeader
          title={isEditMode ? 'Edit mapping' : 'New mapping'}
          description={isEditMode ? 'Update the source-to-target code mapping.' : 'Add a source-to-target code mapping.'}
          breadcrumb={[{ label: 'Lookup tables', path: '/lookups' }, { label: isEditMode ? 'Edit mapping' : 'New mapping' }]}
          actions={
            <Space size={8}>
              <Button onClick={() => navigate('/lookups')}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                form="lookup-editor-form"
                icon={<GatewayIcon name="SaveOutlined" />}
                loading={isSaving}
                disabled={isEditMode && (!lookup || isLoading || isError)}
              >
                {isEditMode ? 'Save changes' : 'Create mapping'}
              </Button>
            </Space>
          }
          compact
        />
      }
    >

      {isEditMode && orgId <= 0 ? (
        <StatePanel
          glyph="searching"
          title="Select an organization to edit this mapping"
          actions={<Button onClick={() => navigate('/lookups')}>Back to lookup tables</Button>}
        />
      ) : isEditMode && isLoading ? (
        <StatePanel glyph="connecting" title="Loading mapping" size="compact" />
      ) : isEditMode && isError ? (
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Mapping could not be loaded"
          description={error instanceof Error ? error.message : 'The request failed. Try again.'}
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : isEditMode && !lookup ? (
        <StatePanel
          glyph="searching"
          title="Mapping not found"
          description="It may have been removed or may not belong to the selected organization."
          actions={<Button onClick={() => navigate('/lookups')}>Back to lookup tables</Button>}
        />
      ) : (
        <Form
          id="lookup-editor-form"
          className="lookup-editor-form"
          form={form}
          layout="vertical"
          onFinish={onFinish}
          disabled={isSaving || (isEditMode && isLoading)}
          requiredMark="optional"
        >
          <ConfigSection title="Mapping type" description="Group related codes under a reusable category.">
            <Form.Item
              name="type"
              label="Type"
              rules={[{ required: true, message: 'Enter a mapping type' }]}
            >
              <FormItemSelect
                placeholder="Select or enter a type"
                showSearch
                mode="tags"
                maxCount={1}
                options={types.map((type) => ({ label: type, value: type }))}
                tokenSeparators={[',']}
              />
            </Form.Item>
          </ConfigSection>

          <div className="lookup-editor-columns">
            <ConfigSection title="Source system">
              <Form.Item
                name="sourceId"
                label="Source code"
                rules={[
                  { required: true, whitespace: true, message: 'Enter a source code' },
                  { max: 255, message: 'Source code must be 255 characters or fewer' },
                ]}
              >
                <Input placeholder="e.g. OP, DX12345" maxLength={255} />
              </Form.Item>
              <Form.Item
                name="sourceLabel"
                label="Source label"
                rules={[{ max: 500, message: 'Source label must be 500 characters or fewer' }]}
              >
                <Input placeholder="Optional display name" maxLength={500} />
              </Form.Item>
            </ConfigSection>

            <ConfigSection title="Target system">
              <Form.Item
                name="targetId"
                label="Target code"
                rules={[
                  { required: true, whitespace: true, message: 'Enter a target code' },
                  { max: 255, message: 'Target code must be 255 characters or fewer' },
                ]}
              >
                <Input placeholder="e.g. AMB, EXT_001" maxLength={255} />
              </Form.Item>
              <Form.Item
                name="targetLabel"
                label="Target label"
                rules={[{ max: 500, message: 'Target label must be 500 characters or fewer' }]}
              >
                <Input placeholder="Optional display name" maxLength={500} />
              </Form.Item>
            </ConfigSection>
          </div>

          <ConfigSection title="Scope and status" description="Entity-specific mappings override the parent mapping.">
            <div className="lookup-editor-columns lookup-editor-columns--settings">
              <Form.Item
                name="orgUnitRid"
                label="Applies to"
                rules={[{ required: true, message: 'Choose where this mapping applies' }]}
              >
                <FormItemSelect
                  options={[
                    { label: 'Parent organization (default)', value: 'parent' },
                    ...(tenant?.childEntities || []).map((entity) => ({
                      label: `${entity.name} (RID ${entity.rid})`,
                      value: entity.rid,
                    })),
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="isActive"
                label="Status"
                valuePropName="checked"
                extra="Inactive mappings remain saved but are excluded from transformations."
              >
                <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
              </Form.Item>
            </div>
          </ConfigSection>

          <div className="lookup-editor-footer">
            <Text color="secondary">Fields marked optional may be left blank.</Text>
            <Space>
              <Button onClick={() => navigate('/lookups')}>Cancel</Button>
              <Button type="primary" htmlType="submit" icon={<GatewayIcon name="SaveOutlined" />} loading={isSaving}>
                {isEditMode ? 'Save changes' : 'Create mapping'}
              </Button>
            </Space>
          </div>
        </Form>
      )}
    </PageTemplate>
  );
};
