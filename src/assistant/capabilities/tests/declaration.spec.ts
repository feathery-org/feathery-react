import {
  buildCapabilitiesDeclaration,
  CAPABILITIES_DECLARATION
} from '../declaration';
import { DOCUMENT_EDITOR_CAPABILITIES } from '../registry';

describe('machine-only capabilities declaration', () => {
  it('contains only the contract version and supported operation names', () => {
    expect(CAPABILITIES_DECLARATION).toEqual({
      documentProtocolVersion: '2',
      supportedOperations: DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op)
    });
    expect(Object.keys(CAPABILITIES_DECLARATION)).toEqual([
      'documentProtocolVersion',
      'supportedOperations'
    ]);
  });

  it('carries no model-facing text, summaries, examples, schemas, reads, or limits', () => {
    const wire = JSON.stringify(CAPABILITIES_DECLARATION);
    for (const forbidden of [
      'summary',
      'example',
      'params',
      'anchorScheme',
      'tracked',
      'reads',
      'limits',
      'engine'
    ]) {
      expect(wire).not.toContain(`"${forbidden}"`);
    }
    expect(wire.length).toBeLessThan(2048);
  });

  it('is byte-stable and deeply frozen across turns', () => {
    const first = JSON.stringify(buildCapabilitiesDeclaration());
    expect(JSON.stringify(buildCapabilitiesDeclaration())).toBe(first);
    expect(JSON.stringify(CAPABILITIES_DECLARATION)).toBe(first);
    expect(Object.isFrozen(CAPABILITIES_DECLARATION)).toBe(true);
    expect(Object.isFrozen(CAPABILITIES_DECLARATION.supportedOperations)).toBe(
      true
    );
  });
});
