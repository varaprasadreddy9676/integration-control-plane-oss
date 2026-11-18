import type { ReactNode } from 'react';

/** One section of a fixed step's editor: the same content the integration page's tab shows. */
export interface StepSection {
  key: string;
  title: string;
  node: ReactNode;
}

/**
 * What the diagram shows in the inspector for the steps that are not stages: the event,
 * the transformation, the send and the retries. The page supplies its own sections, so the
 * diagram edits everything in place.
 */
export type StepEditors = Partial<Record<'trigger' | 'transform' | 'send' | 'retry', StepSection[]>>;
