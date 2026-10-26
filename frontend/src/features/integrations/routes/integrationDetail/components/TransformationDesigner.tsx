import { TransformationSection } from '../../../components/TransformationSection';

interface TransformationDesignerProps {
  scriptValue: string;
  onScriptChange: (value: string) => void;
  sampleInput: string;
  onSampleInputChange: (value: string) => void;
  sampleOutput: string;
  onSampleOutputChange: (value: string) => void;
  availableFields: any[];
  eventPayload: any;
  onUseEventPayload: (payloadText: string) => void;
  getPreviewContext: () => { eventType: string; entityCode: string; entityName: string };
  onValidateScript: () => void;
  onPreviewMeta: (meta: { durationMs?: number; status?: number }) => void;
  onRegisterRunPreview: (fn: () => void) => void;
  eventTypes: string[];
  currentEventType?: string;
}

export const TransformationDesigner = (props: TransformationDesignerProps) => (
  <TransformationSection {...props} />
);
