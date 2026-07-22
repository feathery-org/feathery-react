import {
  buildAssistantTargets,
  getActiveDocxServar,
  readAssistantSelection
} from '../assistantTargets';
import {
  _clearDocxEditors,
  registerDocxEditor
} from '../../assistant/tools/docxEditorRegistry';

const stepWith = (types: string[]) => ({
  servar_fields: types.map((type, i) => ({ servar: { id: `id-${i}`, key: `k-${i}`, type } }))
});

afterEach(() => _clearDocxEditors());

describe('getActiveDocxServar', () => {
  it('finds the docx_editor servar on the step', () => {
    const s = getActiveDocxServar(stepWith(['text_field', 'docx_editor']));
    expect(s).toMatchObject({ type: 'docx_editor', id: 'id-1' });
  });

  it('returns null when no docx_editor field is present', () => {
    expect(getActiveDocxServar(stepWith(['text_field']))).toBeNull();
    expect(getActiveDocxServar(null)).toBeNull();
    expect(getActiveDocxServar({})).toBeNull();
  });
});

describe('buildAssistantTargets', () => {
  it('emits panel + fuser and no document target when no docx field is on the step', () => {
    const targets = buildAssistantTargets('form-1', 'user-1', stepWith(['text_field']));
    expect(targets).toEqual([
      { type: 'panel', id: 'form-1' },
      { type: 'fuser', id: 'user-1' }
    ]);
    expect(targets.some((t) => t.type === 'generated_document')).toBe(false);
  });

  it('additively emits a generated_document target when a docx_editor field is on the step', () => {
    const targets = buildAssistantTargets('form-1', 'user-1', stepWith(['docx_editor']));
    // panel/fuser preserved (additive), document target appended
    expect(targets).toEqual([
      { type: 'panel', id: 'form-1' },
      { type: 'fuser', id: 'user-1' },
      { type: 'generated_document', id: 'id-0' }
    ]);
  });

  it('falls back to the servar key when the servar has no id', () => {
    const step = { servar_fields: [{ servar: { key: 'contract_doc', type: 'docx_editor' } }] };
    const targets = buildAssistantTargets('form-1', undefined, step);
    expect(targets).toContainEqual({
      type: 'generated_document',
      id: 'contract_doc'
    });
    // no fuser target when no user id
    expect(targets.some((t) => t.type === 'fuser')).toBe(false);
  });
});

describe('readAssistantSelection', () => {
  it('returns null when no editor is registered for the form', () => {
    expect(readAssistantSelection('form-1')).toBeNull();
  });

  it('returns the registered editor selection (anchor, clamped text, isCollapsed)', () => {
    const editor = {
      selection: {
        startOffset: '0;3;2',
        endOffset: '0;3;9',
        isEmpty: false,
        text: 'selected words'
      }
    };
    registerDocxEditor('form-1', editor);
    expect(readAssistantSelection('form-1')).toEqual({
      anchor: '0;3',
      text: 'selected words',
      isCollapsed: false
    });
  });

  it('reports a collapsed selection', () => {
    registerDocxEditor('form-1', {
      selection: { startOffset: '0;5', endOffset: '0;5', isEmpty: true, text: '' }
    });
    const sel = readAssistantSelection('form-1');
    expect(sel).toMatchObject({ anchor: '0', isCollapsed: true, text: '' });
  });
});
