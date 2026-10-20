import { Form, Input } from 'antd';
import { Button, Card } from 'antd';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';

const JS_TEMPLATE = `// Return an object that identifies the record this event belongs to.
// Keys are labels you choose; values are extracted from the event payload.
//
// When a follow-up event (e.g. cancellation) arrives, the system runs
// this same script on it and compares the result against pending deliveries.
// Two events match when ALL returned key-value pairs are equal.
//
//   KEY   = your label (any name you like, used only for matching)
//   VALUE = the actual ID pulled from the event payload via 'payload'
//
return {
  appt_id: payload.appt?.apptRID,  // "appt_id" is your label; payload.appt.apptRID is the value
};

// Need to match on multiple fields? Add more keys:
// return {
//   appt_id:    payload.appt?.apptRID,
//   patient_id: payload.patient?.id,
// };`;

// Always-rendered hidden Form.Item so antd registers `subjectExtractionMode` in the
// form store and Form.useWatch receives notifications from setFieldValue calls.
const HiddenModeField = () => (
  <Form.Item name="subjectExtractionMode" hidden noStyle>
    <Input />
  </Form.Item>
);

export const LifecycleSubjectSection = ({
  token,
  colors,
  isReadOnly = false,
  onSwitchToDefault,
}: LifecyclePanelSurfaceProps) => {
  const form = Form.useFormInstance();
  const extractionMode = Form.useWatch<string>('subjectExtractionMode') ?? 'PATHS';

  if (extractionMode === 'SCRIPT') {
    return (
      <>
        <HiddenModeField />
        <Card
          size="small"
          title="JavaScript matching"
          style={{ borderRadius: token.borderRadiusLG, borderColor: colors.neutral[300] }}
          extra={
            <Button
              size="small"
              onClick={() => {
                form.setFieldValue('subjectExtractionMode', 'PATHS');
                form.setFieldValue('subjectExtractionScript', '');
                onSwitchToDefault?.();
              }}
            >
              Use default matching
            </Button>
          }
        >
          <Form.Item name="subjectExtractionScript" style={{ marginBottom: 0 }}>
            <MonacoEditorInput height="200px" placeholder={JS_TEMPLATE} />
          </Form.Item>
        </Card>
      </>
    );
  }

  if (isReadOnly) {
    return <HiddenModeField />;
  }

  return (
    <>
      <HiddenModeField />
      <Button type="link" style={{ padding: 0 }} onClick={() => form.setFieldValue('subjectExtractionMode', 'SCRIPT')}>
        Customize matching with JavaScript
      </Button>
    </>
  );
};
