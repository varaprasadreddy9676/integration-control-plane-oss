import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Typography } from 'antd';
import { RobotOutlined, CopyOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { StageHook } from '../../../../services/stages-api';
import { getAuthoringPrompt } from '../../../../services/stages-api';
import { getLogs } from '../../../../services/api';

const { Text } = Typography;

interface WriteWithAIProps {
  hook: StageHook;
  /** The script as it is now, to change rather than rewrite. */
  current?: string;
  integrationId?: string;
}

/**
 * "Write with AI": say what the step should do and get the prompt to give any AI. It carries
 * what the script may do at this place and the shape of a recent delivery's data (keys and
 * types, never values); the answer is pasted back into the script field and checked with Test.
 * Nothing leaves the console: no AI service is called from here.
 */
export const WriteWithAI = ({ hook, current, integrationId }: WriteWithAIProps) => {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [withShape, setWithShape] = useState(true);
  const [copied, setCopied] = useState(false);

  const build = useMutation({
    mutationFn: async () => {
      let deliveryId: string | undefined;
      if (withShape && integrationId) {
        const recent = await getLogs({ integrationId, limit: 1 }).catch(() => null);
        deliveryId = recent?.data?.[0]?.id;
      }
      return getAuthoringPrompt({ hook, goal: goal.trim(), current, deliveryId });
    },
  });

  const copy = async () => {
    if (!build.data) return;
    await navigator.clipboard?.writeText(build.data.prompt);
    setCopied(true);
  };

  return (
    <>
      <Button icon={<RobotOutlined />} onClick={() => setOpen(true)}>
        Write with AI
      </Button>
      <Modal
        open={open}
        title="Write this step with AI"
        footer={null}
        onCancel={() => setOpen(false)}
        width={640}
        destroyOnClose
        afterClose={() => {
          build.reset();
          setCopied(false);
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text>Say what the step should do. You get a prompt for any AI (ChatGPT, Claude, Copilot...) that tells it exactly what a script can do here.</Text>
          <Input.TextArea
            aria-label="What should this step do?"
            rows={3}
            maxLength={1000}
            placeholder="Skip patients who have not agreed to be messaged"
            value={goal}
            onChange={(event) => {
              setGoal(event.target.value);
              setCopied(false);
            }}
          />
          {integrationId && (
            <Checkbox checked={withShape} onChange={(event) => setWithShape(event.target.checked)}>
              Include the shape of the latest delivery (field names and types, never the values)
            </Checkbox>
          )}
          <Button type="primary" disabled={!goal.trim()} loading={build.isPending} onClick={() => build.mutate()}>
            Make the prompt
          </Button>
          {build.isError && <Alert type="error" showIcon message={(build.error as Error).message} />}
          {build.data && (
            <>
              <Input.TextArea aria-label="Prompt for your AI" readOnly rows={10} value={build.data.prompt} style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12 }} />
              <Space>
                <Button icon={<CopyOutlined />} onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy the prompt'}
                </Button>
                <Text type="secondary">Paste the script it gives back into the Script field, then use the Test tab.</Text>
              </Space>
            </>
          )}
        </Space>
      </Modal>
    </>
  );
};
