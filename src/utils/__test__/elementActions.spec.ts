import { canRunAction } from '../elementActions';

describe('canRunAction', () => {
  const STEP_ID = 'step-1';

  const actionRule = (elements: string[], afterClick = false) => ({
    trigger_event: 'action',
    steps: [],
    elements,
    metadata: { after_click: afterClick }
  });

  const viewRule = (elements: string[]) => ({
    trigger_event: 'view',
    steps: [],
    elements,
    metadata: {}
  });

  const changeRule = (elements: string[]) => ({
    trigger_event: 'change',
    steps: [],
    elements,
    metadata: {}
  });

  describe('action rules', () => {
    const props = (triggerId: string, beforeClickActions = true) => ({
      trigger: { id: triggerId, type: 'tab' },
      beforeClickActions
    });

    it('matches on trigger element id', () => {
      expect(
        canRunAction(
          actionRule(['tab-el-1']),
          STEP_ID,
          props('tab-el-1'),
          undefined
        )
      ).toBe(true);
    });

    it('matches on altMatchId (tab group link_id)', () => {
      expect(
        canRunAction(
          actionRule(['link-abc']),
          STEP_ID,
          props('tab-el-1'),
          'link-abc'
        )
      ).toBe(true);
    });

    it('does not match unrelated ids', () => {
      expect(
        canRunAction(
          actionRule(['other-el']),
          STEP_ID,
          props('tab-el-1'),
          'link-abc'
        )
      ).toBe(false);
    });

    it('does not match when altMatchId is undefined and only link_id is stored', () => {
      expect(
        canRunAction(
          actionRule(['link-abc']),
          STEP_ID,
          props('tab-el-1'),
          undefined
        )
      ).toBe(false);
    });

    it('respects after_click sequencing', () => {
      const rule = actionRule(['link-abc'], true);
      expect(
        canRunAction(rule, STEP_ID, props('tab-el-1', true), 'link-abc')
      ).toBe(false);
      expect(
        canRunAction(rule, STEP_ID, props('tab-el-1', false), 'link-abc')
      ).toBe(true);
    });
  });

  describe('change rules', () => {
    const props = (servarId: string, relatedServarIds?: string[]) => ({
      trigger: {
        id: 'address_line_1',
        _servarId: servarId,
        _relatedServarIds: relatedServarIds,
        type: 'addressSelect'
      }
    });

    it('matches on the servar the user interacted with', () => {
      expect(
        canRunAction(
          changeRule(['servar-line-1']),
          STEP_ID,
          props('servar-line-1'),
          undefined
        )
      ).toBe(true);
    });

    // An address autocomplete writes country/state/city at the same time as the
    // address line, so a rule bound to any of those must still run
    it('matches on a related servar changed by the same interaction', () => {
      expect(
        canRunAction(
          changeRule(['servar-country']),
          STEP_ID,
          props('servar-line-1', ['servar-city', 'servar-country']),
          undefined
        )
      ).toBe(true);
    });

    it('does not match a servar that did not change', () => {
      expect(
        canRunAction(
          changeRule(['servar-state']),
          STEP_ID,
          props('servar-line-1', ['servar-city', 'servar-country']),
          undefined
        )
      ).toBe(false);
    });

    it('handles a missing related servar list', () => {
      expect(
        canRunAction(
          changeRule(['servar-country']),
          STEP_ID,
          props('servar-line-1'),
          undefined
        )
      ).toBe(false);
    });
  });

  describe('view rules', () => {
    const props = (elementId: string) => ({
      visibilityStatus: { elementId, isVisible: true }
    });

    it('matches on reported element id', () => {
      expect(
        canRunAction(viewRule(['el-1']), STEP_ID, props('el-1'), undefined)
      ).toBe(true);
    });

    it('matches when the reported id is a tab group link_id', () => {
      expect(
        canRunAction(
          viewRule(['link-abc']),
          STEP_ID,
          props('link-abc'),
          undefined
        )
      ).toBe(true);
    });

    it('does not match unrelated ids', () => {
      expect(
        canRunAction(viewRule(['link-abc']), STEP_ID, props('el-1'), undefined)
      ).toBe(false);
    });
  });
});
