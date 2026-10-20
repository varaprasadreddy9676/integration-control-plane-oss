import { Breadcrumb, Space, Tag, Typography, Grid } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../design-system/utils';
import { buildUrlWithOrgId } from '../../utils/navigation';

interface Crumb {
  label: string;
  path?: string;
}

interface Props {
  title: string;
  description?: ReactNode;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  statusChips?: Array<{ label: ReactNode; color?: string; onClick?: () => void }>;
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
  statusChips,
  compact = false,
  dense = false,
  titleSuffix,
  morphTitle = false,
}: Props) => {
  const { token, spacing, borderRadius } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  return (
    <div
      className="page-header"
      style={{
        // A page title pressed against the toolbar below it is one of the
        // cheaper-looking details in a dense console; the title needs room to
        // read as the start of a page rather than another row of chrome.
        paddingTop: dense ? 0 : spacing[1],
        marginBottom: dense ? spacing[2] : compact ? spacing[4] : spacing[5],
      }}
    >
      {breadcrumb && (
        <Breadcrumb
          style={{
            marginBottom: spacing[dense ? 1 : 2],
            color: cssVar.text.secondary,
            fontSize: dense ? 12 : undefined,
          }}
          items={breadcrumb.map((crumb) => ({
            title: crumb.path ? <Link to={buildUrlWithOrgId(crumb.path)}>{crumb.label}</Link> : crumb.label,
          }))}
        />
      )}
      <div
        style={
          dense
            ? {
                display: 'flex',
                alignItems: isNarrow ? 'flex-start' : 'center',
                flexDirection: isNarrow ? 'column' : 'row',
                justifyContent: 'space-between',
                gap: spacing[3],
              }
            : {
                padding: `${spacing[2]} 0`,
                borderBottom: `1px solid ${cssVar.border.default}`,
                display: 'grid',
                gridTemplateColumns: actions && !isNarrow ? '1fr auto' : '1fr',
                alignItems: isNarrow ? 'flex-start' : 'center',
                gap: spacing[3],
                rowGap: spacingToNumber(spacing[3]),
                background: 'transparent',
              }
        }
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' }}>
              <Typography.Title
                level={dense ? 5 : compact ? 4 : 3}
                className={morphTitle ? 'vt-entity-title' : undefined}
                style={{ margin: 0, fontWeight: 600 }}
              >
                {title}
              </Typography.Title>
              {titleSuffix}
            </div>
            {description && !dense && (
              <Typography.Text
                type="secondary"
                style={{
                  fontSize: token.fontSize,
                  lineHeight: 1.5,
                }}
              >
                {description}
              </Typography.Text>
            )}
          </div>
          {statusChips && statusChips.length > 0 && (
            <Space wrap style={{ marginTop: spacing[2] }}>
              {statusChips.map((chip, index) => (
                <Tag
                  key={index}
                  onClick={chip.onClick}
                  onKeyDown={
                    chip.onClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            chip.onClick?.();
                          }
                        }
                      : undefined
                  }
                  role={chip.onClick ? 'button' : undefined}
                  tabIndex={chip.onClick ? 0 : undefined}
                  style={{
                    borderRadius: borderRadius.full,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: chip.onClick ? 'pointer' : 'default',
                    color: chip.color ?? cssVar.text.secondary,
                    background: chip.color ? withAlpha(chip.color, 0.1) : cssVar.bg.subtle,
                    borderColor: chip.color ? withAlpha(chip.color, 0.25) : cssVar.border.default,
                    margin: 0,
                  }}
                >
                  {chip.label}
                </Tag>
              ))}
            </Space>
          )}
        </div>
        {actions && (
          <div
            style={{
              display: 'flex',
              gap: spacing['2.5'],
              alignItems: 'center',
              justifyContent: isNarrow ? 'flex-start' : 'flex-end',
              width: isNarrow ? '100%' : 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: spacing['2.5'],
                alignItems: 'center',
                width: '100%',
                justifyContent: isNarrow ? 'flex-start' : 'flex-end',
              }}
            >
              {actions}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
