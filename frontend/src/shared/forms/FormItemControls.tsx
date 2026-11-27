import { Radio, Select } from '@/components/common/LegacyAntdControls';
import type { ComponentProps } from 'react';

type FormItemSelectProps = ComponentProps<typeof Select> & { 'aria-required'?: boolean };
type FormItemRadioGroupProps = ComponentProps<typeof Radio.Group> & { 'aria-required'?: boolean };

// Ant Design Form.Item adds aria-required to its child. Select and Radio.Group
// render generic wrapper divs, where that attribute is not allowed.
export const FormItemSelect = ({ 'aria-required': _ariaRequired, ...props }: FormItemSelectProps) => (
  <Select {...props} />
);

export const FormItemRadioGroup = ({
  'aria-required': _ariaRequired,
  ...props
}: FormItemRadioGroupProps) => <Radio.Group {...props} />;
