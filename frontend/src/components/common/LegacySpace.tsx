import type { CSSProperties, ReactNode, Ref } from 'react';
import { forwardRef } from 'react';
import { Space as AntdSpace } from 'antd';
import type { SpaceProps } from 'antd';
import { Stack } from '@astryxdesign/core/Stack';

type LegacySpaceProps = SpaceProps & { children?: ReactNode };

const sizeInPixels = (size: SpaceProps['size']): number => {
  if (typeof size === 'number') return size;
  if (size === 'middle') return 16;
  if (size === 'large') return 24;
  return 8;
};

const LegacySpaceBase = forwardRef<HTMLDivElement, LegacySpaceProps>(function LegacySpace(
  {
    children,
    direction = 'horizontal',
    size,
    align,
    wrap = false,
    split,
    prefixCls,
    rootClassName,
    classNames,
    styles,
    className,
    style,
    title,
    ...props
  },
  forwardedRef
) {
  const requiresAntd =
    size === undefined ||
    split !== undefined ||
    Array.isArray(size) ||
    align === 'baseline' ||
    title !== undefined ||
    prefixCls !== undefined ||
    rootClassName !== undefined ||
    classNames !== undefined ||
    styles !== undefined;

  if (requiresAntd) {
    return (
      <AntdSpace
        ref={forwardedRef}
        direction={direction}
        size={size}
        align={align}
        wrap={wrap}
        split={split}
        prefixCls={prefixCls}
        rootClassName={rootClassName}
        classNames={classNames}
        styles={styles}
        className={className}
        style={style}
        title={title}
        {...props}
      >
        {children}
      </AntdSpace>
    );
  }

  const stackStyle: CSSProperties = { ...style, gap: `${sizeInPixels(size)}px` };
  stackStyle.display = style?.display || 'inline-flex';
  const stackAlignment = align || (direction === 'horizontal' ? 'center' : undefined);
  return (
    <Stack
      {...props}
      ref={forwardedRef as Ref<HTMLElement>}
      direction={direction}
      align={stackAlignment === 'start' || stackAlignment === 'end' || stackAlignment === 'center' ? stackAlignment : undefined}
      wrap={wrap ? 'wrap' : 'nowrap'}
      gap={0}
      className={className}
      style={stackStyle}
    >
      {children}
    </Stack>
  );
});

export const LegacySpace = Object.assign(LegacySpaceBase, {
  Compact: AntdSpace.Compact,
  Addon: AntdSpace.Addon,
});

export type { LegacySpaceProps };
