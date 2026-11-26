import { useMemo } from 'react';
import { Tooltip } from "@/components/common/LegacyAntdControls";
import { cssVar, useDesignTokens } from '../../design-system/utils';
import { formatNumber } from '../../utils/format';

export interface FunnelData {
  name: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  data: FunnelData[];
  height?: number;
  showPercentages?: boolean;
  onSegmentClick?: (data: FunnelData, index: number) => void;
}

export function FunnelChart({ data, height = 400, showPercentages = true, onSegmentClick }: FunnelChartProps) {
  const { themeColors, spacing, token, shadows, transitions } = useDesignTokens();

  const defaultColors = useMemo(
    () => [themeColors.primary.default, themeColors.info.text, themeColors.success.text, themeColors.warning.text],
    [themeColors]
  );

  const maxValue = useMemo(() => {
    return Math.max(...data.map((d) => d.value), 1);
  }, [data]);

  const coloredData = useMemo(() => {
    return data.map((item, index) => ({
      ...item,
      color: item.color || defaultColors[index % defaultColors.length],
      percentage: (item.value / maxValue) * 100,
      conversionRate: index > 0 ? (item.value / data[index - 1].value) * 100 : 100,
    }));
  }, [data, defaultColors, maxValue]);

  const segmentHeight = (height - (data.length - 1) * 8) / data.length;

  return (
    <div style={{ width: '100%', height, padding: `${spacing[4]} 0` }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing[2], height: '100%' }}>
        {coloredData.map((item, index) => {
          // A step proportional purely to value/maxValue can shrink to a sliver
          // too narrow to fit its own label + count + percentage — confirmed live
          // on a "Delivered" step at ~7% conversion, where the text visibly
          // collided with the shape's edge. Floor it so every step stays readable.
          const widthPercent = Math.max(item.percentage, 22);

          return (
            <Tooltip
              key={`funnel-${index}`}
              title={
                <div>
                  <div className="ui-extracted-8a7601359d">{item.name}</div>
                  <div>{formatNumber(item.value)} events</div>
                  {index > 0 && (
                    <div className="ui-extracted-5b8a4c270e">
                      {item.conversionRate.toFixed(1)}% of previous stage
                    </div>
                  )}
                </div>
              }
            >
              <div
                style={{
                  width: `${widthPercent}%`,
                  height: segmentHeight,
                  backgroundColor: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: token.borderRadius,
                  cursor: onSegmentClick ? 'pointer' : 'default',
                  transition: transitions.allSlow,
                  position: 'relative',
                  boxShadow: shadows.sm,
                }}
                onClick={() => onSegmentClick?.(item, index)}
                onMouseEnter={(e) => {
                  if (onSegmentClick) {
                    e.currentTarget.style.transform = 'scale(1.02)';
                    e.currentTarget.style.boxShadow = shadows.md;
                  }
                }}
                onMouseLeave={(e) => {
                  if (onSegmentClick) {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = shadows.sm;
                  }
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    color: cssVar.text.inverse,
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <div className="ui-extracted-dbcdf3ed65">{item.name}</div>
                  <div className="ui-extracted-cd9b1e1e1f">{formatNumber(item.value)}</div>
                  {showPercentages && index > 0 && (
                    <div className="ui-extracted-f41d59be09">
                      {item.conversionRate.toFixed(1)}% conversion
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
