import { DLQManagement } from '../components/DLQManagement';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';

export const DLQRoute = () => {
  return (
    <PageTemplate
      className="dlq-workspace"
      header={
        <PageHeader
          title="Dead letter queue"
          description="Review failed deliveries, inspect the trace, and choose a safe recovery action."
          compact
        />
      }
    >
      <DLQManagement />
    </PageTemplate>
  );
};
