import type { ReactNode } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { spacingToNumber } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { SectionCard } from './SectionCard';
import { StatePanel } from '../../../../../components/common/StatePanel';

interface TransformationPanelProps {
  isCreate: boolean;
  isEditMode: boolean;
  selectedEventType?: string;
  scriptValue: string;
  /** The editor, shown in place while the integration is being edited. */
  editor?: ReactNode;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  formatScriptForDisplay: (script?: string) => string;
  isLoading?: boolean;
}

export const TransformationPanelHeader = ({
  spacing,
  colors,
}: Pick<TransformationPanelProps, 'spacing' | 'colors'>) => (
  <div className="console-flex-center-gap-2">
    <GatewayIcon
      name="ThunderboltOutlined"
      className="console-title-accent"
    />
    <div>
      <Text weight="semibold" size="lg">
        Payload Transformation
      </Text>
    </div>
  </div>
);

export const TransformationPanelContent = ({
  isCreate,
  isEditMode,
  selectedEventType,
  scriptValue,
  editor,
  spacing,
  token,
  formatScriptForDisplay,
  isLoading = false,
}: TransformationPanelProps) => {
  if (isLoading) {
    return <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading transformation" />;
  }

  // Disable transformation section until event type is selected
  if (!selectedEventType) {
    return (
      <StatePanel
        title="Choose an event type first"
        description="Transformation settings unlock after selection."
        size="compact"
      />
    );
  }

  return (
    <SectionCard
      title="Payload Transformation"
      description="Transform event payloads before delivery"
      spacing={spacing}
      token={token}
    >
      {isCreate || isEditMode ? (
        editor
      ) : scriptValue ? (
        <div>
          <Text display="block" weight="semibold" className="console-margin-bottom-2">
            Transformation Script:
          </Text>
          <MonacoEditorInput height="300px" value={formatScriptForDisplay(scriptValue)} readOnly />
        </div>
      ) : (
        <Text type="supporting" color="secondary">
          No transformation: the event is sent as it is.
        </Text>
      )}
    </SectionCard>
  );
};
