import { useCallback } from 'react';
import { getSchedulingExampleScript } from '../utils/schedulingScripts';
import { copyTextToClipboard } from '../../../../../utils/clipboard';

interface MessageApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export const useSchedulingScripts = (messageApi: MessageApi) => {
  const handleCopyExampleScript = useCallback(
    async (scriptType: 'DELAYED' | 'RECURRING') => {
      const scriptToCopy = getSchedulingExampleScript(scriptType);
      const copied = await copyTextToClipboard(scriptToCopy);
      if (copied) {
        messageApi.success('Script copied to clipboard');
      } else {
        messageApi.error('Failed to copy script to clipboard');
      }
    },
    [messageApi]
  );

  return { handleCopyExampleScript };
};
