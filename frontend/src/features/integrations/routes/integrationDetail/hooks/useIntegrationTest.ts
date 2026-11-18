import { testIntegration } from '../../../../../services/api';

interface UseIntegrationTestParams {
  existingIntegration?: { id?: string };
  messageApi: {
    warning: (msg: string) => void;
    loading: (msg: string, duration?: number) => () => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export const useIntegrationTest = ({
  existingIntegration,
  messageApi
}: UseIntegrationTestParams) => {
  const handleTest = async () => {
    if (!existingIntegration) return;
    const hide = messageApi.loading('Running script test...', 0);
    try {
      await testIntegration(existingIntegration.id as string);
      hide();
      messageApi.success('Test event queued');
    } catch (error) {
      hide();
      const errorMessage = error instanceof Error ? error.message : 'Failed to send test event';
      messageApi.error(errorMessage);
    }
  };

  return { handleTest };
};
