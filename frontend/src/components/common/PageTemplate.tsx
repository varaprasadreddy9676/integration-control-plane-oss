import type { ReactNode } from 'react';
import { PageHeader, type PageHeaderProps } from './PageHeader';

interface PageTemplateProps extends Omit<PageHeaderProps, 'title'> {
  title?: string;
  header?: ReactNode;
  as?: 'main' | 'div';
  className?: string;
  children: ReactNode;
  contentClassName?: string;
}

export const PageTemplate = ({
  children,
  contentClassName,
  className,
  header,
  title,
  as = 'main',
  ...headerProps
}: PageTemplateProps) => {
  const Root = as;
  return (
    <Root className={['page-template', className].filter(Boolean).join(' ')} data-testid="page-template">
      {header ? (
        <div className="page-template__header-slot">{header}</div>
      ) : title ? (
        <PageHeader title={title} {...headerProps} />
      ) : null}
      <div className={['page-template__content', contentClassName].filter(Boolean).join(' ')}>{children}</div>
    </Root>
  );
};
