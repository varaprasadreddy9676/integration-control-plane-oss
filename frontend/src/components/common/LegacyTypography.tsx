import { useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Link as RouterLink } from 'react-router-dom';
import { copyTextToClipboard } from '../../utils/clipboard';

type LegacyTextType =
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'error'
  | 'info'
  | 'supporting'
  | 'disabled'
  | 'default';
type EllipsisOptions = boolean | { rows?: number; expandable?: boolean; symbol?: ReactNode; tooltip?: unknown };

interface LegacyTextProps {
  children?: ReactNode;
  type?: LegacyTextType;
  strong?: boolean;
  code?: boolean;
  italic?: boolean;
  color?: string;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  style?: CSSProperties;
  className?: string;
  display?: 'inline' | 'block';
  role?: string;
  ellipsis?: EllipsisOptions;
  copyable?: boolean | { text?: string };
  as?: 'span' | 'p' | 'div' | 'label';
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  href?: string;
  to?: string;
  target?: string;
  rel?: string;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
}

const statusColor: Record<LegacyTextType, string | undefined> = {
  secondary: 'var(--color-text-secondary)',
  success: 'var(--color-success-text)',
  warning: 'var(--color-warning-text)',
  danger: 'var(--color-error-text)',
  error: 'var(--color-error-text)',
  info: 'var(--color-text-secondary)',
  supporting: 'var(--color-text-secondary)',
  disabled: 'var(--color-text-disabled)',
  default: undefined,
};

function resolveContent(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

function LegacyTextContent({
  children,
  type = 'default',
  strong = false,
  code = false,
  italic = false,
  color,
  weight,
  style,
  className,
  role,
  ellipsis,
  as = 'span',
  onClick,
  expanded = false,
}: LegacyTextProps & { expanded?: boolean }) {
  const maxLines = typeof ellipsis === 'object' ? ellipsis.rows || 1 : ellipsis ? 1 : 0;
  const textStyle: CSSProperties = {
    ...style,
    ...(color ? { color } : statusColor[type] ? { color: statusColor[type] } : {}),
    ...(italic ? { fontStyle: 'italic' } : {}),
    ...(maxLines && !expanded
      ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines, overflow: 'hidden' }
      : {}),
  };
  return (
    <AstryxText
      as={as}
      type={code ? 'code' : type === 'supporting' || type === 'secondary' || type === 'info' ? 'supporting' : 'body'}
      color={
        type === 'secondary' || type === 'disabled' || type === 'supporting' || type === 'info'
          ? 'secondary'
          : 'inherit'
      }
      weight={weight || (strong ? 'semibold' : 'normal')}
      display={as === 'span' ? 'inline' : 'block'}
      maxLines={maxLines && !expanded ? maxLines : 0}
      hasTruncateTooltip={Boolean(maxLines && !expanded)}
      className={className}
      style={textStyle}
      role={role}
      onClick={onClick}
    >
      {children}
    </AstryxText>
  );
}

function CopyAction({ children, copyable }: Pick<LegacyTextProps, 'children' | 'copyable'>) {
  if (!copyable) return null;
  const copyText = typeof copyable === 'object' && copyable.text ? copyable.text : resolveContent(children);
  return <Button label="Copy" variant="ghost" size="sm" onClick={() => void copyTextToClipboard(copyText)} />;
}

function ExpandableText(props: LegacyTextProps) {
  const [expanded, setExpanded] = useState(false);
  const ellipsis = props.ellipsis;
  return (
    <>
      <LegacyTextContent {...props} expanded={expanded} />
      <Button
        label={expanded ? 'Less' : typeof ellipsis === 'object' && ellipsis.symbol ? String(ellipsis.symbol) : 'More'}
        variant="ghost"
        size="sm"
        onClick={() => setExpanded((value) => !value)}
      />
      <CopyAction children={props.children} copyable={props.copyable} />
    </>
  );
}

function LegacyText(props: LegacyTextProps) {
  if (typeof props.ellipsis === 'object' && props.ellipsis.expandable === true) {
    return <ExpandableText {...props} />;
  }
  return (
    <>
      <LegacyTextContent {...props} />
      <CopyAction children={props.children} copyable={props.copyable} />
    </>
  );
}

function LegacyParagraph(props: LegacyTextProps) {
  return <LegacyText {...props} as="p" />;
}

function LegacyTitle({ level = 4, children, ...props }: LegacyTextProps & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return (
    <Heading level={level} className={props.className} style={props.style}>
      {children}
    </Heading>
  );
}

function LegacyLink({
  children,
  href,
  to,
  target,
  rel,
  onClick,
  onMouseEnter,
  onFocus,
  style,
  className,
}: LegacyTextProps) {
  if (to) {
    return (
      <RouterLink
        to={to}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        target={target}
        rel={rel}
        style={style}
        className={className}
      >
        {children}
      </RouterLink>
    );
  }
  if (!href && onClick) {
    return (
      <Button
        label={resolveContent(children)}
        variant="ghost"
        size="sm"
        onClick={onClick}
        className={className}
        style={style}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
      >
        {children}
      </Button>
    );
  }
  return (
    <a
      href={href}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      target={target}
      rel={rel}
      style={style}
      className={className}
    >
      {children}
    </a>
  );
}

export const Typography = {
  Text: LegacyText,
  Paragraph: LegacyParagraph,
  Title: LegacyTitle,
  Link: LegacyLink,
};

export const Text = LegacyText;
export const Paragraph = LegacyParagraph;
export const Title = LegacyTitle;
export const Link = LegacyLink;
