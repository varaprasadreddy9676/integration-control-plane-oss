import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { spacingToNumber } from '../../../../../design-system/utils';

interface MultiActionHeaderProps {
  actionsCount: number;
  spacing: Record<string, string>;
  colors: any;
}

export const MultiActionHeader = ({ actionsCount, spacing, colors }: MultiActionHeaderProps) => (
  <div className="console-flex-center-gap-2">
    <GatewayIcon
      name="BranchesOutlined"
      className="console-title-accent"
    />
    <div>
      <Text weight="semibold">Actions</Text>
    </div>
  </div>
);
