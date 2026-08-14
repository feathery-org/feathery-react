// Ported from the POC's test/tag-dsl.test.js. The byte-stability assertions are
// the important ones: the editor adapter locates a write target by exact tag
// match and the engine dedupes writes by tag, so two spellings of the same
// binding must canonicalize to the same string.
import {
  BoundDefinition,
  Definition,
  encodeValue,
  formatTag,
  parseTag,
  TagError
} from '../tagDsl';

/** parseTag returns null for foreign controls; these cases expect a definition. */
function parsed(tag: string): Definition {
  const definition = parseTag(tag);
  if (!definition) throw new Error(`expected a definition for ${tag}`);
  return definition;
}

function bound(tag: string): BoundDefinition {
  const definition = parsed(tag);
  if (definition.kind === 'table')
    throw new Error(`expected a bound definition for ${tag}`);
  return definition;
}

describe('tag DSL', () => {
  it('treats key=value tags as order independent', () => {
    const a = parsed('[[name=unit_cost|type=currency|row=r-1]]');
    const b = parsed('[[row=r-1|type=currency|name=unit_cost]]');
    expect(a).toEqual(b);
    expect(formatTag(a)).toBe(formatTag(b)); // canonical order restored
    expect(formatTag(a)).toBe('[[name=unit_cost|type=currency|row=r-1]]');
  });

  it('infers kind: expr makes a formula, table a marker, else a field', () => {
    const field = bound('[[name=project.name]]');
    expect(field.kind).toBe('field');
    expect(field.isEditable).toBe(true);
    expect(field.isDeletable).toBe(true);

    const formula = bound(
      '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]'
    );
    expect(formula.kind).toBe('formula');
    expect(
      formula.kind === 'formula' ? formula.expression : undefined
    ).toBe('mul(quantity,unit_cost)');
    expect(formula.isEditable).toBe(false);
    expect(formula.isDeletable).toBe(false);

    expect(parseTag('[[table=costs]]')).toEqual({
      version: 2,
      kind: 'table',
      tableId: 'costs'
    });
  });

  it('applies defaults: field text, formula currency:USD:2, del=delete', () => {
    expect(bound('[[name=note]]').fieldType).toEqual({ kind: 'text' });
    expect(bound('[[name=t|expr=sum(a.b)]]').fieldType).toEqual({
      kind: 'currency',
      currency: 'USD',
      scale: 2
    });
    expect(bound('[[name=note]]').isDeletable).toBe(true);
    expect(bound('[[name=note|del=keep]]').isDeletable).toBe(false);
    expect(bound('[[name=note]]').isGlobal).toBe(false);
  });

  it('round-trips an explicit global identity and omits the false default', () => {
    const field = bound('[[name=tax_rate|type=percent|global=true]]');
    expect(field.isGlobal).toBe(true);
    expect(formatTag(field)).toBe(
      '[[name=tax_rate|type=percent|global=true]]'
    );

    const formula = bound(
      '[[name=tax_total|expr=mul(subtotal,tax_rate)|global=true]]'
    );
    expect(formula.isGlobal).toBe(true);
    expect(formatTag(formula)).toBe(
      '[[name=tax_total|expr=mul(subtotal,tax_rate)|global=true]]'
    );

    const explicitFalse = bound(
      '[[name=tax_rate|type=percent|global=false]]'
    );
    expect(explicitFalse.isGlobal).toBe(false);
    expect(formatTag(explicitFalse)).toBe('[[name=tax_rate|type=percent]]');
  });

  it('expands bare type shorthands to their defaults', () => {
    expect(bound('[[name=a|type=currency]]').fieldType).toEqual({
      kind: 'currency',
      currency: 'USD',
      scale: 2
    });
    expect(bound('[[name=a|type=decimal]]').fieldType).toEqual({
      kind: 'decimal',
      scale: 2
    });
    expect(bound('[[name=a|type=date]]').fieldType).toEqual({
      kind: 'date',
      format: 'YYYY-MM-DD'
    });
    expect(bound('[[name=a|type=currency:EUR:0]]').fieldType).toEqual({
      kind: 'currency',
      currency: 'EUR',
      scale: 0
    });
    expect(bound('[[name=a|type=percent]]').fieldType).toEqual({
      kind: 'percent'
    });
  });

  it('round-trips canonically, byte-stable and minimal', () => {
    const tags = [
      '[[name=project.name]]',
      '[[name=quantity|type=integer|row=r-1]]',
      '[[name=unit_cost|type=currency|row=r-1]]',
      '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]',
      '[[name=grand_total|expr=sum(costs_subtotal,costs_tax)]]',
      '[[name=tax_rate|type=percent|del=keep]]',
      '[[name=note|default=n/a|label=Note]]',
      '[[table=costs]]'
    ];
    for (const tag of tags) expect(formatTag(parsed(tag))).toBe(tag);

    // Verbose spellings collapse to the minimal canonical form.
    expect(formatTag(parsed('[[v=2|name=a|type=text|del=delete]]'))).toBe(
      '[[name=a]]'
    );
    expect(formatTag(parsed('[[name=a|type=currency:USD:2]]'))).toBe(
      '[[name=a|type=currency]]'
    );
    expect(
      formatTag(parsed('[[name=t|expr=sum(a.b)|type=currency:USD:2]]'))
    ).toBe('[[name=t|expr=sum(a.b)]]');
  });

  it('still parses legacy positional v1 tags and canonicalizes them to v2', () => {
    const field = bound('[[v1|field|unit_cost|currency:USD:2|rw|delete|row=r-1]]');
    expect(field.version).toBe(1);
    expect(field.fieldType).toEqual({
      kind: 'currency',
      currency: 'USD',
      scale: 2
    });
    expect(formatTag(field)).toBe('[[name=unit_cost|type=currency|row=r-1]]');

    const formula = bound(
      '[[v1|formula|grand_total|currency:USD:2|sum(costs.line_total)|ro|keep]]'
    );
    expect(
      formula.kind === 'formula' ? formula.expression : undefined
    ).toBe('sum(costs.line_total)');
    expect(formatTag(formula)).toBe(
      '[[name=grand_total|expr=sum(costs.line_total)]]'
    );

    expect(parseTag('[[v1|table|costs]]')).toEqual({
      version: 1,
      kind: 'table',
      tableId: 'costs'
    });
  });

  it('skips foreign content controls instead of erroring', () => {
    expect(parseTag('customer')).toBeNull();
    expect(parseTag('[[fx:total]]')).toBeNull();
    expect(parseTag('[[just some text]]')).toBeNull();
    expect(parseTag('')).toBeNull();
  });

  it('rejects malformed tags strictly', () => {
    const bad = [
      '[[name=bad name]]', // invalid identifier
      '[[name=a|junk]]', // bare token next to key=value
      '[[name=a|nope=1]]', // unknown key
      '[[name=a|name=b]]', // duplicate key
      '[[name=a|type=money]]', // unknown type
      '[[name=a|type=currency:usd:2]]', // lowercase currency
      '[[name=a|del=maybe]]', // bad delete policy
      '[[name=a|global=maybe]]', // bad global scope
      '[[name=a|expr=]]', // empty expression
      '[[name=a|expr=sum(x)|del=delete]]', // formulas are always keep
      '[[table=costs|name=a]]', // table takes no other keys
      '[[v=3|name=a]]', // unknown version
      '[[type=integer]]', // missing name
      '[[name=a|row=bad id]]', // invalid row id
      '[[v1|widget|a]]', // unknown legacy kind
      '[[v1|field|a|text|ro|delete]]' // legacy wrong policy
    ];
    for (const tag of bad) {
      expect(() => parseTag(tag)).toThrow(TagError);
    }
  });

  it('percent-encodes reserved delimiters in values', () => {
    const def = bound(`[[name=note|default=${encodeValue('a|b=c[d]')}]]`);
    expect(def.options.default).toBe('a|b=c[d]');
    expect(formatTag(def)).toBe('[[name=note|default=a%7Cb%3Dc%5Bd%5D]]');
  });

  it('carries value and default as separate keys', () => {
    const def = bound('[[name=qty|type=integer|value=12|default=1]]');
    expect(def.options.value).toBe('12');
    expect(def.options.default).toBe('1');
    // Canonical order is fixed: value before default.
    expect(formatTag(def)).toBe('[[name=qty|type=integer|value=12|default=1]]');
  });

  it('percent-encodes value the same way as default', () => {
    const def = bound(`[[name=item|value=${encodeValue('Purell [500ml]')}]]`);
    expect(def.options.value).toBe('Purell [500ml]');
    expect(formatTag(def)).toBe('[[name=item|value=Purell %5B500ml%5D]]');
  });
});
