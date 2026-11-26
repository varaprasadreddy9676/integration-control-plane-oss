import { useMemo, useState } from 'react';
import { Card, Form, Select, Input, Space, Collapse, Tooltip, Divider } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getLookupTypes } from '../../../services/api';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import type { LookupConfig, UnmappedBehavior } from '../../../mocks/types';
import { Button } from '../../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../../components/common';

interface LookupConfigSectionProps {
  value?: LookupConfig[];
  onChange?: (value: LookupConfig[]) => void;
}

export const LookupConfigSection = ({ value = [], onChange }: LookupConfigSectionProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const [expanded, setExpanded] = useState<string[]>([]);

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes,
  });

  const types = typesData?.types || [];

  const handleAdd = () => {
    const newLookup: LookupConfig = {
      type: '',
      sourceField: '',
      targetField: '',
      unmappedBehavior: 'PASSTHROUGH',
      defaultValue: undefined,
    };
    onChange?.([...value, newLookup]);
    setExpanded([`${value.length}`]);
  };

  const handleRemove = (index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange?.(newValue);
  };

  const handleChange = (index: number, field: keyof LookupConfig, fieldValue: any) => {
    const newValue = [...value];
    newValue[index] = {
      ...newValue[index],
      [field]: fieldValue,
    };
    onChange?.(newValue);
  };

  return (
    <div>
      <div style={{ marginBottom: spacing[4], display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="console-flex-center-gap-2">
          <GatewayIcon size="md" name="DatabaseOutlined" className="console-text-accent" />
          <Heading level={5} className="console-margin-none">
            Code Mappings (Lookups)
          </Heading>
          <Tooltip title="Apply code translation after transformation completes">
            <GatewayIcon size="xsm" name="InfoCircleOutlined" style={{ color: cssVar.text.muted }} />
          </Tooltip>
        </div>
        <Button type="dashed" size="small" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleAdd}>
          Add Mapping
        </Button>
      </div>

      <Notice
        type="info"
        icon={<GatewayIcon name="InfoCircleOutlined" />}
        message="Lookup mappings run AFTER standard transformations"
        description={
          <div>
            <p className="console-margin-bottom-2">
              Lookups translate codes from your system to external system codes. They execute in the following order:
            </p>
            <ol className="ui-extracted-cae904643a">
              <li>Your transformation script runs first</li>
              <li>Lookup mappings apply to the transformed payload</li>
              <li>Final payload delivered to target endpoint</li>
            </ol>
            <p className="console-margin-bottom-2">
              <strong>In Scripts:</strong> You can also use lookups directly in transformation scripts with the{' '}
              <code>lookup(code, type)</code> function.
            </p>
            <p className="console-margin-bottom-none">
              <Link to="/help/lookup-guide" className="console-inline-flex-center-gap-1">
                <GatewayIcon name="BookOutlined" /> View Complete Lookup Tables Guide
              </Link>
            </p>
          </div>
        }
        className="console-margin-bottom-4"
      />

      {value.length === 0 ? (
        <Card
          style={{
            textAlign: 'center',
            padding: spacing[6],
            background: cssVar.bg.subtle,
            border: `1px dashed ${colors.neutral[300]}`,
          }}
        >
          <GatewayIcon
            name="DatabaseOutlined"
            style={{ width: 48, height: 48, color: cssVar.text.muted, marginBottom: spacing[3] }}
          />
          <Text type="supporting" color="secondary">
            No lookup mappings configured. Click "Add Mapping" to start.
          </Text>
        </Card>
      ) : (
        <Collapse
          activeKey={expanded}
          onChange={(keys) => setExpanded(keys as string[])}
          items={value.map((lookup, index) => ({
            key: `${index}`,
            label: (
              <Space>
                <GatewayIcon name="SwapOutlined" className="console-text-accent" />
                <Text weight="semibold">{lookup.type || 'Untitled Mapping'}</Text>
                {lookup.sourceField && lookup.targetField && (
                  <Text type="supporting" size="sm" color="secondary">
                    {lookup.sourceField} → {lookup.targetField}
                  </Text>
                )}
                <Text type="supporting" color="secondary">
                  {lookup.unmappedBehavior}
                </Text>
              </Space>
            ),
            extra: (
              <Button
                type="text"
                danger
                size="small"
                icon={<GatewayIcon name="DeleteOutlined" />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(index);
                }}
              />
            ),
            children: (
              <div>
                <Space direction="vertical" className="console-width-full" size="middle">
                  {/* Mapping Type */}
                  <div>
                    <Text weight="semibold" display="block" className="console-margin-bottom-1">
                      Mapping Type *
                    </Text>
                    <Select
                      placeholder="Select or type to create new (e.g., SERVICE_CODE, DIAGNOSIS_CODE)"
                      className="console-width-full"
                      value={lookup.type ? [lookup.type] : undefined}
                      onChange={(val) => handleChange(index, 'type', Array.isArray(val) ? val[0] : val)}
                      showSearch
                      mode="tags"
                      maxCount={1}
                      tokenSeparators={[',']}
                      options={types.map((t) => ({ label: t, value: t }))}
                    />
                    <Text type="supporting" size="sm" color="secondary">
                      The category of code mapping (matches lookup table type)
                    </Text>
                  </div>

                  <Divider className="console-margin-y-2" />

                  {/* Source and Target Fields */}
                  <div>
                    <Text weight="semibold" display="block" className="console-margin-bottom-1">
                      Source Field *
                    </Text>
                    <Input
                      placeholder="e.g., serviceCode or items[].serviceCode"
                      value={lookup.sourceField}
                      onChange={(e) => handleChange(index, 'sourceField', e.target.value)}
                    />
                    <Text type="supporting" size="sm" color="secondary">
                      Field path in payload to translate. Supports arrays using [] notation.
                    </Text>
                  </div>

                  <div>
                    <Text weight="semibold" display="block" className="console-margin-bottom-1">
                      Target Field *
                    </Text>
                    <Input
                      placeholder="e.g., externalServiceCode or items[].externalCode"
                      value={lookup.targetField}
                      onChange={(e) => handleChange(index, 'targetField', e.target.value)}
                    />
                    <Text type="supporting" size="sm" color="secondary">
                      Field path where translated code will be written
                    </Text>
                  </div>

                  <Divider className="console-margin-y-2" />

                  {/* Unmapped Behavior */}
                  <div>
                    <Text weight="semibold" display="block" className="console-margin-bottom-1">
                      Unmapped Behavior *
                    </Text>
                    <Select
                      className="console-width-full"
                      value={lookup.unmappedBehavior}
                      onChange={(val: UnmappedBehavior) => handleChange(index, 'unmappedBehavior', val)}
                      options={[
                        {
                          label: 'PASSTHROUGH - Keep original value',
                          value: 'PASSTHROUGH',
                        },
                        {
                          label: 'FAIL - Block delivery',
                          value: 'FAIL',
                        },
                        {
                          label: 'DEFAULT - Use default value',
                          value: 'DEFAULT',
                        },
                      ]}
                    />
                    <Text type="supporting" size="sm" color="secondary">
                      What to do when no mapping is found for a code
                    </Text>
                  </div>

                  {/* Default Value (only show if DEFAULT behavior selected) */}
                  {lookup.unmappedBehavior === 'DEFAULT' && (
                    <div>
                      <Text weight="semibold" display="block" className="console-margin-bottom-1">
                        Default Value *
                      </Text>
                      <Input
                        placeholder="Enter default value for unmapped codes"
                        value={lookup.defaultValue}
                        onChange={(e) => handleChange(index, 'defaultValue', e.target.value)}
                      />
                      <Text type="supporting" size="sm" color="secondary">
                        This value will be used when no mapping exists
                      </Text>
                    </div>
                  )}
                </Space>
              </div>
            ),
          }))}
        />
      )}

      {/* Script Helper Documentation */}
      {value.length > 0 && (
        <Notice
          type="success"
          className="console-margin-top-4"
          message="Using Lookups in Transformation Scripts"
          description={
            <div>
              <p className="console-margin-bottom-2">
                You can also use lookups directly in your SCRIPT transformations:
              </p>
              <pre
                style={{
                  background: cssVar.table.codeBg,
                  color: cssVar.text.primary,
                  padding: spacing[3],
                  borderRadius: 4,
                  fontSize: 'var(--console-type-caption)',
                  overflow: 'auto',
                }}
              >
                {`// In your transformation script:
return {
  ...payload,
  // Simple lookup
  externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),

  // With fallback
  externalDiagCode: lookup(payload.diagCode, 'DIAGNOSIS_CODE') || 'UNKNOWN',

  // Array mapping
  items: payload.items.map(item => ({
    ...item,
    externalCode: lookup(item.code, 'ITEM_CODE')
  }))
};`}
              </pre>
              <Text type="supporting" size="sm" color="secondary">
                The <code>lookup(code, type)</code> function is available in all transformation scripts and respects the
                hierarchical lookup resolution (entity-specific → parent-level).
              </Text>
            </div>
          }
        />
      )}
    </div>
  );
};
