// Why this file exists: the engine distinguishes an EXPECTED failure (a value
// that does not parse, a malformed tag) from a real bug by catching a specific
// Error subclass. The package compiles to es5, where the emit runs
// `Error.call(this, message) || this` and Error-as-a-function returns a FRESH
// plain Error - so the constructed object is not an instance of the subclass and
// `instanceof` is false.
//
// Jest compiles with babel targeting modern Node, so classes stay native and
// `instanceof` works here no matter what. That is exactly the trap: this bug
// cannot reproduce in the test environment, and it took a browser to find. The
// symptom was a formula placeholder ("…") failing to parse during a reconcile,
// escaping the catch that exists for it, and surfacing as `reconcile-failed`
// instead of a diagnostic - so nothing recalculated at all.
//
// These tests pin the property that survives compilation: identity by NAME, not
// by prototype chain. A prototype-stripped error stands in for what the es5 emit
// produces.
import { applyRules, hasBlockingErrors } from '../engine';
import { isFormulaError } from '../formula';
import { isTagError } from '../tagDsl';
import { isValueError, ValueError } from '../valueTypes';
import { getAt, scanBindings, setOccurrenceText } from '../sfdtAdapter';
import { buildCostsFixture } from './fixtures/costsFixture';

/** What the es5 emit effectively produces: right name, wrong prototype. */
function downlevelled(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  Object.setPrototypeOf(error, Error.prototype);
  return error;
}

describe('error identity survives compilation', () => {
  it('recognises its own errors', () => {
    expect(isValueError(new ValueError('x'))).toBe(true);
  });

  it('recognises a prototype-stripped error by name', () => {
    // The es5 case. A bare `instanceof` returns false for all three of these.
    expect(isValueError(downlevelled('ValueError', 'not a number'))).toBe(true);
    expect(isTagError(downlevelled('TagError', 'bad tag'))).toBe(true);
    expect(isFormulaError(downlevelled('FormulaError', 'bad expr'))).toBe(true);
  });

  it('does not claim unrelated errors', () => {
    expect(isValueError(new Error('boom'))).toBe(false);
    expect(isValueError(new TypeError('boom'))).toBe(false);
    expect(isValueError(downlevelled('TagError', 'x'))).toBe(false);
    expect(isValueError(null)).toBe(false);
    expect(isValueError(undefined)).toBe(false);
    expect(isValueError('ValueError')).toBe(false);
  });

  it('keeps the message and the name', () => {
    const error = new ValueError('not a number: "…"');
    expect(error.message).toBe('not a number: "…"');
    expect(error.name).toBe('ValueError');
  });
});

describe('an unparseable value reports rather than throws', () => {
  // The behaviour the identity check protects: reconcile must survive text that
  // cannot parse, whatever the build did to the error class.
  const withText = (text: string) => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    const quantity = index.tables
      .get('costs')!
      .rows[0].bindings.get('quantity')!;
    return setOccurrenceText(doc, quantity, text);
  };

  it('diagnoses invalid input instead of failing the reconcile', () => {
    const result = applyRules(withText('twelve'), {});
    expect(
      result.diagnostics.some((entry) => entry.code === 'invalid-input')
    ).toBe(true);
    expect(hasBlockingErrors(result.diagnostics)).toBe(true);
  });

  it('tolerates the formula placeholder a fresh template carries', () => {
    // "…" is what template import and row adoption write into a formula cell
    // before the engine computes it. Parsing it fails BY DESIGN, on the same pass
    // that replaces it, so the catch has to hold or the whole reconcile dies.
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    const lineTotal = index.tables
      .get('costs')!
      .rows[0].bindings.get('line_total')!;
    const pending = setOccurrenceText(doc, lineTotal, '…');

    const result = applyRules(pending, {});

    // Recomputed, not thrown.
    expect(getAt(result.sfdt, lineTotal.path).inlines[0].text).toBe(
      '$1,800.00'
    );
  });
});
