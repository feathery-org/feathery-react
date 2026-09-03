import { getPanelRuntimeSnapshot } from '../panelRuntime';
import internalState from '../../../utils/internalState';

// `error` (field-wide) and `errorRows` (per-row) must be DISJOINT, so a
// field-wide failure and a row failure can coexist without either masking the
// other, and `error` is never an ambiguous copy of a row's message.
describe('panel snapshot error vs errorRows', () => {
  const formId = 'form-snap-errors';

  const snapshotFor = (inlineErrors: any) => {
    (internalState as any)[formId] = {
      currentStep: {
        id: 's1',
        key: 'step-1',
        servar_fields: [
          {
            servar: { key: 'name', type: 'text_field', metadata: {} },
            position: [0],
            properties: {}
          }
        ],
        buttons: [],
        texts: [],
        images: [],
        subgrids: [],
        progress_bars: [],
        tabs: [],
        next_conditions: []
      },
      visiblePositions: { '0': [true] },
      formSettings: {},
      fields: {},
      inlineErrors
    };
    const snap: any = getPanelRuntimeSnapshot(formId);
    delete (internalState as any)[formId];
    return snap.currentStepFields.find((f: any) => f.key === 'name');
  };

  it('reports a field-wide error alone', () => {
    const f = snapshotFor({ name: { message: 'Field failed' } });
    expect(f.error).toBe('Field failed');
    expect(f.errorRows).toBeUndefined();
  });

  it('does NOT copy a row message into error', () => {
    const f = snapshotFor({ name: { byIndex: { 1: { message: 'Row 1 bad' } } } });
    // error stays absent: the failure is row-scoped, not field-wide.
    expect(f.error).toBeUndefined();
    expect(f.errorRows).toEqual({ 1: 'Row 1 bad' });
  });

  it('reports BOTH when a field-wide and a row error coexist', () => {
    const f = snapshotFor({
      name: { message: 'Field failed', byIndex: { 2: { message: 'Row 2 bad' } } }
    });
    // Neither masks the other.
    expect(f.error).toBe('Field failed');
    expect(f.errorRows).toEqual({ 2: 'Row 2 bad' });
  });
});
