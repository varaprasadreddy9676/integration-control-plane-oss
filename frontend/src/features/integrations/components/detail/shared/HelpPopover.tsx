import { ReactNode } from 'react';
import { Popover } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';

interface HelpPopoverProps {
  content: ReactNode;
  title?: string;
  placement?:
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'topLeft'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomRight'
    | 'leftTop'
    | 'leftBottom'
    | 'rightTop'
    | 'rightBottom';
  trigger?: 'hover' | 'click' | 'focus';
  maxWidth?: number;
}

/**
 * HelpPopover - Reusable help icon with popover for progressive disclosure
 *
 * Usage:
 * <Form.Item
 *   label={
 *     <Space size={4}>
 *       Target URL
 *       <HelpPopover
 *         title="URL Requirements"
 *         content={<UrlRequirementsHelp />}
 *       />
 *     </Space>
 *   }
 * >
 *   <Input />
 * </Form.Item>
 */
export const HelpPopover = ({
  content,
  title,
  placement = 'right',
  trigger = 'click',
  maxWidth = 360,
}: HelpPopoverProps) => {
  return (
    <Popover
      content={<div style={{ maxWidth }}>{content}</div>}
      title={title}
      placement={placement}
      trigger={trigger}
      overlayStyle={{ maxWidth: maxWidth + 48 }} // Account for padding
    >
      <GatewayIcon size="xsm" name="InfoCircleOutlined" className="console-text-info console-cursor-help" />
    </Popover>
  );
};
