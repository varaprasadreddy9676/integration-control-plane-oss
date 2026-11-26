import { useQuery } from '@tanstack/react-query';
import type { StageHook, StageRunner, StageTemplate } from '../../../../services/stages-api';
import { getStageRunners, getStageRuntime, getStageTemplates } from '../../../../services/stages-api';
import { Icon } from '../../canvas/CanvasNode';

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

type IconName = Parameters<typeof Icon>[0]['name'];
const KNOWN_ICONS: IconName[] = ['script', 'http', 'transform', 'send'];

/** A menu choice: its name, and under it why you would pick it. */
const Choice = ({ title, hint, icon }: { title: string; hint?: string; icon?: string }) => (
  <span
    className="ui-extracted-f79e18ea39"
  >
    {icon && KNOWN_ICONS.includes(icon as IconName) && (
      <span className="ui-extracted-682d1d9116">
        <Icon name={icon as IconName} size={16} />
      </span>
    )}
    <span className="ui-extracted-ddf321b4ef">
      <span className="console-font-weight-medium">{title}</span>
      {hint && (
        <span
          className="ui-extracted-79eeb4a47d"
        >
          {hint}
        </span>
      )}
    </span>
  </span>
);

/** The "add a stage" menu for a hook: runners that can run there, then templates for it. */
export const stageMenu = (
  hook: StageHook,
  library: { runners?: StageRunner[]; templates?: StageTemplate[] },
  { onRunner, onTemplate }: LibraryHandlers
) => {
  const fromRunners = (library.runners || [])
    .filter((runner) => runner.hooks.includes(hook))
    .map((runner) => ({
      key: `runner:${runner.type}`,
      label: <Choice title={runner.label} hint={runner.description} icon={runner.presentation?.icon} />,
    }));
  const fromTemplates = (library.templates || [])
    .filter((template) => template.hook === hook)
    .map((template) => ({
      key: `template:${template.id}`,
      label: (
        <Choice title={`${template.label}${template.recommended ? ' (suggested)' : ''}`} hint={template.description} />
      ),
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
