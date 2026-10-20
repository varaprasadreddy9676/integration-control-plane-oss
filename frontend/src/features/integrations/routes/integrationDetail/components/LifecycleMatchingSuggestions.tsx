import { Alert, Button, Space, Tag } from 'antd';
import type { MatchingSuggestionsResult } from '../utils/matchingSuggestions';

interface LifecycleMatchingSuggestionsProps {
  suggestions: MatchingSuggestionsResult;
  onAccept: () => void;
  onDismiss: () => void;
}

export const LifecycleMatchingSuggestions = ({
  suggestions,
  onAccept,
  onDismiss,
}: LifecycleMatchingSuggestionsProps) => (
  <Alert
    type={suggestions.confidence === 'high' ? 'success' : 'info'}
    showIcon
    message="Suggested matching fields"
    description={
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap>
          {suggestions.suggestedPaths.map((item) => (
            <Tag key={`${item.key}:${item.paths}`} color="blue">
              {item.key}: {item.paths}
            </Tag>
          ))}
        </Space>
        <Space wrap>
          <Button type="primary" size="small" onClick={onAccept}>
            Use suggestions
          </Button>
          <Button size="small" onClick={onDismiss}>
            Edit manually
          </Button>
        </Space>
      </Space>
    }
  />
);
