import { useQuery } from '@tanstack/react-query';
import type { StageHook, StageRunner, StageTemplate } from '../../../../services/stages-api';
import { getStageRunners, getStageRuntime, getStageTemplates } from '../../../../services/stages-api';

/** What a stage can be made from: the runners, the templates for this integration, and whether stages run on this server. */
export const useStageLibrary = (integrationId?: string) => {
  const runners = useQuery({ queryKey: ['stage-runners'], queryFn: getStageRunners, staleTime: 5 * 60 * 1000 });
  const templates = useQuery({
    queryKey: ['stage-templates', integrationId],
    queryFn: () => getStageTemplates(integrationId),
  });
  const runtime = useQuery({ queryKey: ['stage-runtime'], queryFn: getStageRuntime, staleTime: 60 * 1000 });
  return { runners, templates, runtime };
};

interface LibraryHandlers {
  onRunner: (type: string) => void;
  onTemplate: (templateId: string) => void;
}

/** The "add a stage" menu for a hook: runners that can run there, then templates for it. */
export const stageMenu = (
  hook: StageHook,
  library: { runners?: StageRunner[]; templates?: StageTemplate[] },
  { onRunner, onTemplate }: LibraryHandlers
) => {
  const fromRunners = (library.runners || [])
    .filter((runner) => runner.hooks.includes(hook))
    .map((runner) => ({ key: `runner:${runner.type}`, label: runner.label }));
  const fromTemplates = (library.templates || [])
    .filter((template) => template.hook === hook)
    .map((template) => ({
      key: `template:${template.id}`,
      label: `${template.label}${template.recommended ? ' (suggested)' : ''}`,
    }));
  return {
    items: [
      ...fromRunners,
      ...(fromTemplates.length
        ? [
            { type: 'divider' as const },
            { key: 'templates', type: 'group' as const, label: 'From a template', children: fromTemplates },
          ]
        : []),
    ],
    onClick: ({ key }: { key: string }) => {
      const [kind, id] = key.split(':');
      if (kind === 'runner') onRunner(id);
      else if (kind === 'template') onTemplate(id);
    },
  };
};
