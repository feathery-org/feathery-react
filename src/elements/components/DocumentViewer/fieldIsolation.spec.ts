import { scopeReviewAnnotations } from './fieldIsolation';

const suffix = (n: string) => `__feathery_occurrence_${n.repeat(32)}`;
const text = (id: string) => ({
  id,
  fieldName: `1own_FullName${suffix(id)}`,
  fieldType: 'Tx',
  fieldValue: 'Owner'
});

it('scopes same-named fields to their PDF, without changing storage ids or source data', () => {
  const annotation = { id: '42R', fieldName: '1own_H_Email', fieldType: 'Tx' };
  const a = {};
  const b = {};
  const scopedA = scopeReviewAnnotations(a, [annotation])[0];
  const scopedB = scopeReviewAnnotations(b, [annotation])[0];
  expect(scopedA.fieldName).not.toBe(scopedB.fieldName);
  expect(scopedA.id).toBe('42R');
  expect(annotation.fieldName).toBe('1own_H_Email');
  expect(scopeReviewAnnotations(a, [annotation])[0]).toEqual(scopedA);
});

it('keeps prepared text occurrences independent by default', () => {
  const proxy = {};
  const annotations = [text('1'), text('2')];
  const independent = scopeReviewAnnotations(proxy, annotations);
  expect(independent[0].fieldName).not.toBe(independent[1].fieldName);
  expect(independent.map((a) => a.id)).toEqual(['1', '2']);
});

it('keeps radio groups linked within the same PDF', () => {
  const annotations = ['1', '2'].map((id) => ({
    id,
    fieldName: 'choice',
    fieldType: 'Btn'
  }));
  const scoped = scopeReviewAnnotations({}, annotations);
  expect(scoped[0].fieldName).toBe(scoped[1].fieldName);
});

it('does not pretend to unlink legacy shared fields that were not prepared', () => {
  const annotations = ['1', '2'].map((id) => ({
    id,
    fieldType: 'Tx',
    fieldName: 'legacy'
  }));
  const scoped = scopeReviewAnnotations({}, annotations);
  expect(scoped[0].fieldName).toBe(scoped[1].fieldName);
});
