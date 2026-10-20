import { Form } from 'antd';
import type { FormInstance } from 'antd';
import type { ReactNode } from 'react';

interface IntegrationFormContainerProps {
  form: FormInstance;
  initialValues: any;
  onFinish: (values: any) => void;
  /** Called with the fields that failed validation on a submit attempt. */
  onValidationFailed?: (errorFields: { name: (string | number)[]; errors: string[] }[]) => void;
  children: ReactNode;
}

export const IntegrationFormContainer = ({
  form,
  initialValues,
  onFinish,
  onValidationFailed,
  children,
}: IntegrationFormContainerProps) => {
  return (
    <Form
      layout="vertical"
      form={form}
      initialValues={initialValues}
      onFinish={onFinish}
      // This form is far taller than the viewport. Without this, a required
      // field that fails validation off-screen just turns red where nobody can
      // see it and Save appears to do nothing.
      scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
      onFinishFailed={({ errorFields }) => onValidationFailed?.(errorFields)}
    >
      {children}
    </Form>
  );
};
