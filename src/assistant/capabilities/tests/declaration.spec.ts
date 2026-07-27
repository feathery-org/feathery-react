import {
  buildCapabilitiesDeclaration,
  CAPABILITIES_DECLARATION
} from '../declaration';

// The declaration lands inside the model prompt on every turn. If its bytes
// vary between two builds - map-iteration nondeterminism, timestamps, random
// ids - every turn gets a different prompt prefix and the prompt cache is
// silently destroyed, inflating cost on every request. This is the guard.
describe('capabilities declaration byte stability (prompt-cache guard)', () => {
  it('two consecutive builds serialise to identical bytes', () => {
    const first = JSON.stringify(buildCapabilitiesDeclaration());
    const second = JSON.stringify(buildCapabilitiesDeclaration());
    expect(second).toBe(first);
    expect(JSON.stringify(CAPABILITIES_DECLARATION)).toBe(first);
  });

  it('a serialise/parse/serialise round trip is also byte-stable', () => {
    const first = JSON.stringify(CAPABILITIES_DECLARATION);
    expect(JSON.stringify(JSON.parse(first))).toBe(first);
  });

  it('declares the full document_editor surface within the size envelope', () => {
    expect(CAPABILITIES_DECLARATION.version).toBe('1');
    expect(CAPABILITIES_DECLARATION.surfaces).toHaveLength(1);
    const surface = CAPABILITIES_DECLARATION.surfaces[0];
    expect(surface.surface).toBe('document_editor');
    // 37 shipped + set_cell_formula (arithmetic) + replace_selection.
    expect(surface.ops).toHaveLength(39);
    // The retrieval ladder (S3), cheapest first - `structure` leads because it
    // is the leg the too-large refusal names as its remedy.
    expect(surface.reads.map((read) => read.read)).toEqual([
      'structure',
      'outline',
      'section',
      'table_facts',
      'table_column',
      'full',
      'occurrences'
    ]);
    // The backend forwards the declaration with a 64 KB cap; staying well
    // under it here means the cap can never silently drop a real declaration.
    expect(JSON.stringify(CAPABILITIES_DECLARATION).length).toBeLessThan(
      32 * 1024
    );
  });

  it('the shared instance is deeply frozen (no cross-turn mutation)', () => {
    expect(Object.isFrozen(CAPABILITIES_DECLARATION)).toBe(true);
    expect(Object.isFrozen(CAPABILITIES_DECLARATION.surfaces[0])).toBe(true);
    expect(Object.isFrozen(CAPABILITIES_DECLARATION.surfaces[0].ops[0])).toBe(
      true
    );
    expect(
      Object.isFrozen(CAPABILITIES_DECLARATION.surfaces[0].ops[0].params)
    ).toBe(true);
    expect(Object.isFrozen(CAPABILITIES_DECLARATION.surfaces[0].reads[0])).toBe(
      true
    );
  });
});
