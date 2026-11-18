/**
 * Two ways to edit what happens around a delivery, over one engine:
 *   classic  the familiar tabs (Transformation, Response Transform, Delivery follow-up)
 *   steps    the Delivery tab, where each of those is a step
 * Each person chooses (and it is remembered); nothing that is actually in effect is ever hidden.
 */

export type DeliveryLayout = 'classic' | 'steps';

const KEY = 'delivery-layout';

export const readDeliveryLayout = (): DeliveryLayout => {
  try {
    return window.localStorage.getItem(KEY) === 'steps' ? 'steps' : 'classic';
  } catch {
    return 'classic';
  }
};

export const saveDeliveryLayout = (layout: DeliveryLayout) => {
  try {
    window.localStorage.setItem(KEY, layout);
  } catch {
    // The choice just is not remembered.
  }
};

interface LayoutFacts {
  layout: DeliveryLayout;
  isMultiAction: boolean;
  /** Steps the integration already has. */
  stageCount: number;
  /** stageMigration.state: a migrated integration's old settings are cleared and only steps act. */
  migrationState?: string;
  responseCheckOn: boolean;
  followUpOn: boolean;
}

export const visibleDeliveryTabs = ({ layout, isMultiAction, stageCount, migrationState, responseCheckOn, followUpOn }: LayoutFacts) => {
  const alreadySteps = stageCount > 0 || migrationState === 'SWITCHED' || migrationState === 'SHADOW';
  const steps = isMultiAction || layout === 'steps' || alreadySteps;
  return {
    steps,
    // The old tabs and the steps do the same jobs: show the old ones in classic, or while their setting is in effect.
    responseTransform: !isMultiAction && (layout === 'steps' ? responseCheckOn : migrationState !== 'SWITCHED'),
    followUp: !isMultiAction && (layout === 'steps' ? followUpOn : migrationState !== 'SWITCHED'),
    stepsShownAnyway: !isMultiAction && layout !== 'steps' && alreadySteps,
  };
};
