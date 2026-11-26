import { Breadcrumb, Space, Grid } from '@/components/common/LegacyAntdControls';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buildUrlWithOrgId } from '../../utils/navigation';

interface Crumb {
  label: string;
  path?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  summary?: ReactNode;
  compact?: boolean;
  /**
   * Slim single-line variant for editor/detail screens: no bordered
   * background box, no description paragraph, minimal vertical space so
   * the form content starts as close to the top as possible.
   */
  dense?: boolean;
  titleSuffix?: ReactNode;
  /** Detail pages: the title is where a clicked list item morphs to (see view-transition.ts). */
  morphTitle?: boolean;
}

export const PageHeader = ({
  title,
  description,
  breadcrumb,
  actions,
  summary,
  compact = false,
  dense = false,
  titleSuffix,
  morphTitle = false,
}: PageHeaderProps) => {
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const visibleBreadcrumb = breadcrumb?.filter(
    (crumb, index) => index !== breadcrumb.length - 1 || crumb.label.trim() !== title.trim()
  );

  return (
    <div className="page-header" data-dense={dense} data-compact={compact}>
      {visibleBreadcrumb && visibleBreadcrumb.length > 0 && (
        <Breadcrumb
          className="page-header-breadcrumb"
          data-dense={dense}
          items={visibleBreadcrumb.map((crumb) => ({
            title: crumb.path ? <Link to={buildUrlWithOrgId(crumb.path)}>{crumb.label}</Link> : crumb.label,
          }))}
        />
      )}
      <div
        className="page-header-content"
        data-layout={dense ? 'dense' : 'standard'}
        data-narrow={isNarrow}
        data-has-actions={Boolean(actions)}
      >
        <div className="console-flex-min-width-0">
          <Stack gap={1}>
            <div className="page-header-title-row">
              <Heading
                level={dense ? 5 : compact ? 4 : 3}
                className={`page-header-title${morphTitle ? ' vt-entity-title' : ''}`}
              >
                {title}
              </Heading>
              {titleSuffix}
            </div>
            {description && !dense && (
              <Text type="supporting" as="div" className="page-header-description">
                {description}
              </Text>
            )}
          </Stack>
          {summary && (
            <Text type="supporting" as="div" display="block" className="console-margin-top-2">
              {summary}
            </Text>
          )}
        </div>
        {actions && (
          <div className="page-header-actions" data-narrow={isNarrow}>
            <div className="page-header-actions-inner" data-narrow={isNarrow}>
              {actions}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
