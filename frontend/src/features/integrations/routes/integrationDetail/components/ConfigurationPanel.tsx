import type { FormInstance } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { ConfigurationSection } from '../../../components/detail/ConfigurationSection';
import { SectionHeader } from './SectionHeader';
import { StatePanel } from '../../../../../components/common/StatePanel';

interface ConfigurationPanelProps {
  form: FormInstance;
  eventTypes: any[];
  uiConfig: any;
  tenant: any;
  isMultiAction: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedOrgUnits?: any[];
  spacing: Record<string, string>;
  token: any;
  colors: any;
  isLoading?: boolean;
}

export const ConfigurationPanelHeader = ({ spacing, colors }: Pick<ConfigurationPanelProps, 'spacing' | 'colors'>) => (
  <SectionHeader
    icon={
      <GatewayIcon name="ApiOutlined" className="console-title-accent" />
    }
    title="Configuration"
    spacing={spacing}
  />
);

export const ConfigurationPanelContent = ({
  form,
  eventTypes,
  uiConfig,
  tenant,
  isMultiAction,
  eventTypesLoading,
  scopeValue,
  excludedOrgUnits,
  spacing,
  token,
  colors,
  isLoading = false,
}: ConfigurationPanelProps) =>
  isLoading ? (
    <StatePanel glyph="connecting" tone="busy" title="Loading configuration" size="compact" />
  ) : (
    <ConfigurationSection
      form={form}
      eventTypes={eventTypes}
      uiConfig={uiConfig}
      tenant={tenant}
      isMultiAction={isMultiAction}
      eventTypesLoading={eventTypesLoading}
      scopeValue={scopeValue}
      excludedOrgUnits={excludedOrgUnits}
      spacing={spacing}
      token={token}
      colors={colors}
    />
  );
