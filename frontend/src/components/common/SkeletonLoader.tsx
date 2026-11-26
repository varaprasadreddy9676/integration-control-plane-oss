import { Skeleton, Card, Space } from '@/components/common/LegacyAntdControls';

interface SkeletonLoaderProps {
  variant?: 'card' | 'table' | 'metric' | 'list' | 'chart' | 'form';
  count?: number;
  animated?: boolean;
}

export const SkeletonLoader = ({ variant = 'card', count = 1, animated = true }: SkeletonLoaderProps) => {
  const renderMetricSkeleton = () => (
    <Card className="console-fade-in skeleton-metric-card">
      <Space direction="vertical" size="large" className="console-width-full">
        <Skeleton.Input active={animated} size="small" className="skeleton-width-120" />
        <Skeleton.Input active={animated} size="large" className="skeleton-metric-value" />
        <Skeleton.Input active={animated} size="small" className="skeleton-width-100" />
      </Space>
    </Card>
  );

  const renderCardSkeleton = () => (
    <Card className="console-fade-in">
      <Skeleton active={animated} paragraph={{ rows: 4 }} title={{ width: '60%' }} />
    </Card>
  );

  const renderTableSkeleton = () => (
    <Card className="console-fade-in">
      <Skeleton active={animated} paragraph={{ rows: 8 }} title={{ width: '40%' }} />
    </Card>
  );

  const renderListSkeleton = () => (
    <div className="console-fade-in skeleton-list">
      <Skeleton active={animated} avatar paragraph={{ rows: 2 }} />
    </div>
  );

  const renderChartSkeleton = () => (
    <Card className="console-fade-in skeleton-chart-card">
      <Skeleton.Input active={animated} size="small" className="skeleton-chart-title" />
      <Skeleton.Image active={animated} className="skeleton-chart-image" />
    </Card>
  );

  const renderFormSkeleton = () => (
    <Card className="console-fade-in">
      <Space direction="vertical" size="large" className="console-width-full">
        <div>
          <Skeleton.Input active={animated} size="small" className="skeleton-field-label skeleton-width-100" />
          <Skeleton.Input active={animated} size="large" block />
        </div>
        <div>
          <Skeleton.Input active={animated} size="small" className="skeleton-field-label skeleton-width-120" />
          <Skeleton.Input active={animated} size="large" block />
        </div>
        <div>
          <Skeleton.Input active={animated} size="small" className="skeleton-field-label skeleton-width-80" />
          <Skeleton.Input active={animated} size="large" block className="skeleton-textarea" />
        </div>
        <Skeleton.Button active={animated} size="large" className="skeleton-width-150" />
      </Space>
    </Card>
  );

  const renderVariant = () => {
    switch (variant) {
      case 'metric':
        return renderMetricSkeleton();
      case 'table':
        return renderTableSkeleton();
      case 'list':
        return renderListSkeleton();
      case 'chart':
        return renderChartSkeleton();
      case 'form':
        return renderFormSkeleton();
      default:
        return renderCardSkeleton();
    }
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            animationDelay: `${index * 50}ms`,
          }}
        >
          {renderVariant()}
        </div>
      ))}
    </>
  );
};
