import type { FormInstance } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { AuthenticationSection } from '../../../components/detail/AuthenticationSection';
import { SectionHeader } from './SectionHeader';
import { StatePanel } from '../../../../../components/common/StatePanel';

interface AuthenticationPanelProps {
  form: FormInstance;
  uiConfig: any;
  selectedAuthType?: string;
  isMultiAction: boolean;
  spacing: Record<string, string>;
  colors: any;
  isLoading?: boolean;
  currentEventType?: string;
}

export const AuthenticationPanelHeader = ({
  spacing,
  colors,
}: Pick<AuthenticationPanelProps, 'spacing' | 'colors'>) => (
  <SectionHeader
    icon={
      <GatewayIcon name="LockOutlined" className="console-title-accent" />
    }
    title="Security"
    spacing={spacing}
  />
);

export const AuthenticationPanelContent = ({
  form,
  uiConfig,
  selectedAuthType,
  isMultiAction,
  spacing,
  isLoading = false,
  currentEventType,
}: AuthenticationPanelProps) => {
  if (isLoading) {
    return <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading security settings" />;
  }

  // Disable authentication section until event type is selected
  if (!currentEventType) {
    return (
      <StatePanel
        title="Choose an event type first"
        description="Security settings unlock after selection."
        size="compact"
      />
    );
  }

  return (
    <AuthenticationSection
      form={form}
      uiConfig={uiConfig}
      selectedAuthType={selectedAuthType}
      isMultiAction={isMultiAction}
      spacing={spacing}
    />
  );
};
