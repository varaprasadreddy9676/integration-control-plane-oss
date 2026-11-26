import { Popover } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';

interface HelpPopoverProps {
  title: string;
  content: React.ReactNode;
}

/**
 * HelpPopover - Reusable help icon with popover
 */
export const HelpPopover = ({ title, content }: HelpPopoverProps) => (
  <Popover title={title} content={content} trigger="hover">
    <GatewayIcon
      size="xsm"
      name="QuestionCircleOutlined"
      className="ui-extracted-e0e82d505c"
    />
  </Popover>
);
