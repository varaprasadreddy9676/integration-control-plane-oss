import type { FormInstance } from "@/components/common/LegacyAntdControls";

export const buildPreviewContext = (form: FormInstance) => ({
  eventType: form.getFieldValue('eventType') ?? 'UNKNOWN',
  entityCode: form.getFieldValue('entityCode') ?? 'ENTITY',
  entityName: form.getFieldValue('entityName') ?? 'Entity'
});
