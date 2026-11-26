/**
 * Flow Top Bar Component
 *
 * Top navigation bar with save, test, preview, and other controls
 */

import React from 'react';
import { Space, Dropdown, Input, Switch, Tooltip } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import type { MenuProps } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import type { FlowState, FlowValidationResult } from '../state/flowTypes';
import { Button } from '../../../components/common/LegacyButton';

export interface FlowTopBarProps {
  flowState: FlowState;
  validation: FlowValidationResult;
  isDirty: boolean;
  isSaving: boolean;
  isTesting: boolean;
  onSave: () => void;
  onTest: () => void;
  onPreview: () => void;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onActiveToggle: (isActive: boolean) => void;
  onOpenNodePalette?: () => void;
}

export const FlowTopBar: React.FC<FlowTopBarProps> = ({
  flowState,
  validation,
  isDirty,
  isSaving,
  isTesting,
  onSave,
  onTest,
  onPreview,
  onBack,
  onNameChange,
  onActiveToggle,
  onOpenNodePalette,
}) => {
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [nameValue, setNameValue] = React.useState(flowState.name);

  React.useEffect(() => {
    setNameValue(flowState.name);
  }, [flowState.name]);

  const handleNameSubmit = () => {
    onNameChange(nameValue);
    setIsEditingName(false);
  };

  const handleNameKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setNameValue(flowState.name);
      setIsEditingName(false);
    }
  };

  // Settings dropdown menu
  const settingsMenuItems: MenuProps['items'] = [
    {
      key: 'rate-limits',
      label: 'Configure Rate Limits',
      icon: <GatewayIcon name="SettingOutlined" />,
    },
    {
      key: 'advanced',
      label: 'Advanced Settings',
      icon: <GatewayIcon name="SettingOutlined" />,
    },
    {
      type: 'divider',
    },
    {
      key: 'export-json',
      label: 'Export as JSON',
      icon: <GatewayIcon name="CodeOutlined" />,
    },
    {
      key: 'version-history',
      label: 'Version History',
      icon: <GatewayIcon name="HistoryOutlined" />,
      disabled: true,
    },
  ];

  const canSave = validation.errors.length === 0;
  const canTest = validation.errors.length === 0;

  return (
    <div className="flow-builder-topbar">
      {/* Left section - Back button and name */}
      <Space size="middle" className="flow-builder-topbar-identity">
        <Button icon={<GatewayIcon name="ArrowLeftOutlined" />} onClick={onBack} type="text">
          Back
        </Button>

        <div className="flow-builder-toolbar-divider" />

        {isEditingName ? (
          <Input
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyPress}
            autoFocus
            className="flow-builder-name-input"
            placeholder="Integration name"
          />
        ) : (
          <div onClick={() => setIsEditingName(true)} className="flow-builder-name flow-builder-name--editable">
            <Text weight="semibold" className="console-type-section">
              {flowState.name || 'Untitled Integration'}
            </Text>
            {isDirty && (
              <Text color="secondary" className="console-margin-left-2 console-type-caption">
                (Unsaved)
              </Text>
            )}
          </div>
        )}

        <span className="flow-builder-mode-label">{getModeLabel(flowState.mode)}</span>

        {/* Validation status */}
        {validation.errors.length > 0 ? (
          <Tooltip
            trigger={['hover', 'focus']}
            title={
              <div>
                <div className="flow-builder-tooltip-heading">
                  {validation.errors.length} Error{validation.errors.length > 1 ? 's' : ''}
                </div>
                <ul className="console-list-reset-indent">
                  {validation.errors.slice(0, 3).map((error, idx) => (
                    <li key={idx}>{error.message}</li>
                  ))}
                  {validation.errors.length > 3 && <li>... and {validation.errors.length - 3} more</li>}
                </ul>
              </div>
            }
          >
            <span
              className="flow-builder-validation-state flow-builder-validation-state--error"
              tabIndex={0}
              role="img"
              aria-label={`${validation.errors.length} validation ${validation.errors.length === 1 ? 'error' : 'errors'}: ${validation.errors.map((error) => error.message).join('. ')}`}
            >
              <GatewayIcon name="ExclamationCircleOutlined" aria-hidden="true" />
              {validation.errors.length} {validation.errors.length === 1 ? 'error' : 'errors'}
            </span>
          </Tooltip>
        ) : validation.warnings.length > 0 ? (
          <Tooltip
            title={
              <div>
                <div className="flow-builder-tooltip-heading">
                  {validation.warnings.length} Warning{validation.warnings.length > 1 ? 's' : ''}
                </div>
                <ul className="console-list-reset-indent">
                  {validation.warnings.slice(0, 3).map((warning, idx) => (
                    <li key={idx}>{warning.message}</li>
                  ))}
                  {validation.warnings.length > 3 && <li>... and {validation.warnings.length - 3} more</li>}
                </ul>
              </div>
            }
          >
            <span className="flow-builder-validation-state flow-builder-validation-state--warning">
              <GatewayIcon name="WarningOutlined" aria-hidden="true" />
              {validation.warnings.length} {validation.warnings.length === 1 ? 'warning' : 'warnings'}
            </span>
          </Tooltip>
        ) : (
          <Tooltip title="No validation errors">
            <GatewayIcon size="md" name="CheckCircleOutlined" className="console-text-success" />
          </Tooltip>
        )}
      </Space>

      {/* Right section - Actions */}
      <Space size="middle" className="flow-builder-topbar-actions">
        {/* Active toggle */}
        <Space className="flow-builder-active-toggle">
          <Text color="secondary">Active:</Text>
          <Switch checked={flowState.isActive} onChange={onActiveToggle} checkedChildren="ON" unCheckedChildren="OFF" />
        </Space>

        <div className="flow-builder-toolbar-divider" />

        {/* Preview button */}
        <Tooltip title="Preview backend payload">
          <Button icon={<GatewayIcon name="EyeOutlined" />} onClick={onPreview}>
            Preview
          </Button>
        </Tooltip>

        {/* Test button */}
        <Tooltip title={!canTest ? 'Fix validation errors before testing' : 'Test this integration with sample data'}>
          <Button
            icon={<GatewayIcon name="PlayCircleOutlined" />}
            onClick={onTest}
            disabled={!canTest}
            loading={isTesting}
          >
            Test
          </Button>
        </Tooltip>

        {/* Save button */}
        <Tooltip
          title={!canSave ? 'Fix validation errors before saving' : isDirty ? 'Save changes' : 'No changes to save'}
        >
          <Button
            type="primary"
            icon={<GatewayIcon name="SaveOutlined" />}
            onClick={onSave}
            disabled={!canSave}
            loading={isSaving}
          >
            Save
          </Button>
        </Tooltip>

        <Button
          className="flow-builder-mobile-palette-button"
          icon={<GatewayIcon name="AppstoreOutlined" />}
          onClick={onOpenNodePalette}
        >
          Nodes
        </Button>

        {/* Settings dropdown */}
        <Dropdown menu={{ items: settingsMenuItems }} placement="bottomRight">
          <Button icon={<GatewayIcon name="SettingOutlined" />} />
        </Dropdown>
      </Space>
    </div>
  );
};

function getModeLabel(mode: string): string {
  switch (mode) {
    case 'INBOUND':
      return 'Inbound';
    case 'OUTBOUND_EVENT':
      return 'Event delivery';
    case 'OUTBOUND_SCHEDULED':
      return 'Scheduled delivery';
    default:
      return mode;
  }
}

export default FlowTopBar;
