import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { isValidElement } from 'react';
import { Button as AstryxButton } from '@astryxdesign/core/Button';

type LegacyButtonType = 'primary' | 'default' | 'dashed' | 'text' | 'link' | 'button' | 'submit' | 'reset';
type LegacyButtonSize = 'small' | 'middle' | 'large';

export interface LegacyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  type?: LegacyButtonType;
  htmlType?: 'button' | 'submit' | 'reset';
  size?: LegacyButtonSize;
  danger?: boolean;
  loading?: boolean | { delay?: number };
  icon?: ReactNode;
  href?: string;
  target?: string;
  rel?: string;
  block?: boolean;
  ghost?: boolean;
  children?: ReactNode;
}

const getTextContent = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getTextContent(node.props.children);
  return '';
};

const getLabel = (children: ReactNode, ariaLabel: string | undefined, title: string | undefined) => {
  if (ariaLabel?.trim()) return ariaLabel;
  const content = getTextContent(children).trim();
  if (content) return content;
  if (title?.trim()) return title;
  return 'Action';
};

export const LegacyButton = ({
  type = 'default',
  htmlType,
  size = 'middle',
  danger = false,
  loading = false,
  icon,
  href,
  target,
  rel,
  block = false,
  ghost = false,
  children,
  disabled,
  className,
  style,
  'aria-label': ariaLabel,
  title,
  onClick,
  ...props
}: LegacyButtonProps) => {
  const visualType = type === 'button' || type === 'submit' || type === 'reset' ? 'default' : type;
  const isIconOnly = Boolean(icon && (children === undefined || children === null || children === false));
  const variant = danger
    ? visualType === 'primary' ? 'destructive' : 'ghost'
    : visualType === 'primary' ? 'primary' : visualType === 'text' || visualType === 'link' ? 'ghost' : 'secondary';
  const mappedSize = size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'md';
  const mappedStyle: CSSProperties = block ? { ...style, width: '100%' } : style ?? {};
  const mappedClassName = [
    'legacy-button-compat',
    visualType === 'dashed' ? 'legacy-button-compat--dashed' : '',
    ghost ? 'legacy-button-compat--ghost' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <AstryxButton
      {...props}
      {...({ disabled: Boolean(disabled) } as Record<string, unknown>)}
      type={htmlType ?? (type === 'button' || type === 'submit' || type === 'reset' ? type : 'button')}
      label={getLabel(children, ariaLabel, title)}
      variant={variant}
      size={mappedSize}
      isDisabled={disabled}
      isLoading={Boolean(loading)}
      icon={icon}
      isIconOnly={isIconOnly}
      href={href}
      target={target}
      rel={rel}
      className={mappedClassName}
      style={mappedStyle}
      onClick={onClick}
    >
      {children}
    </AstryxButton>
  );
};

export { LegacyButton as Button };
