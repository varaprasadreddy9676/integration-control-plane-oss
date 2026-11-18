import { beforeEach, describe, expect, it } from 'vitest';
import { readDeliveryLayout, saveDeliveryLayout, visibleDeliveryTabs } from '../features/integrations/routes/integrationDetail/utils/deliveryLayout';

const base = { layout: 'classic' as const, isMultiAction: false, stageCount: 0, migrationState: undefined, responseCheckOn: false, followUpOn: false };

describe('which delivery tabs an integration shows', () => {
  it('classic: the familiar tabs, and no steps tab', () => {
    expect(visibleDeliveryTabs(base)).toEqual({ steps: false, responseTransform: true, followUp: true, stepsShownAnyway: false });
  });

  it('steps: the steps tab replaces the two tabs that do the same job', () => {
    expect(visibleDeliveryTabs({ ...base, layout: 'steps' })).toEqual({ steps: true, responseTransform: false, followUp: false, stepsShownAnyway: false });
  });

  it('never hides a legacy setting that is in effect, in either layout', () => {
    const shown = visibleDeliveryTabs({ ...base, layout: 'steps', responseCheckOn: true, followUpOn: true });
    expect(shown).toMatchObject({ steps: true, responseTransform: true, followUp: true });
  });

  it('an integration that already has steps shows them, whatever the layout, and says so', () => {
    expect(visibleDeliveryTabs({ ...base, stageCount: 2 })).toMatchObject({ steps: true, stepsShownAnyway: true });
    expect(visibleDeliveryTabs({ ...base, migrationState: 'SWITCHED' })).toMatchObject({ steps: true, stepsShownAnyway: true });
    expect(visibleDeliveryTabs({ ...base, layout: 'steps', stageCount: 2 }).stepsShownAnyway).toBe(false);
  });

  it('a migrated integration keeps the familiar tabs in classic (they edit its steps), and has no duplicates in steps', () => {
    expect(visibleDeliveryTabs({ ...base, migrationState: 'SWITCHED' })).toMatchObject({ steps: true, responseTransform: true, followUp: true });
    expect(visibleDeliveryTabs({ ...base, layout: 'steps', migrationState: 'SWITCHED', responseCheckOn: true, followUpOn: true })).toMatchObject({
      steps: true,
      responseTransform: false,
      followUp: false,
    });
  });

  it('multi-action has only steps for these jobs, in either layout', () => {
    expect(visibleDeliveryTabs({ ...base, isMultiAction: true })).toMatchObject({ steps: true, responseTransform: false, followUp: false, stepsShownAnyway: false });
  });
});

describe('the remembered layout', () => {
  beforeEach(() => window.localStorage.clear());

  it('is classic until someone chooses, then remembered', () => {
    expect(readDeliveryLayout()).toBe('classic');
    saveDeliveryLayout('steps');
    expect(readDeliveryLayout()).toBe('steps');
    window.localStorage.setItem('delivery-layout', 'nonsense');
    expect(readDeliveryLayout()).toBe('classic');
  });
});
