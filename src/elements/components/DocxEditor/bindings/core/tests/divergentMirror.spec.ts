/**
 * Two occurrences of one field that hold DIFFERENT values.
 *
 * A binding name is a claim that every occurrence carrying it shows one value.
 * A document where they disagree does not satisfy that claim, and the engine
 * cannot know which one the author meant - so it must say so rather than pick.
 *
 * It already does, in one of the two places it decides. With no previous
 * snapshot to arbitrate, disagreement raises `ambiguous-edit` and writes
 * nothing. With a snapshot in which nothing was edited, the same disagreement
 * took the FIRST occurrence's value and fanned it across the others as an
 * invisible 'sync' write: no revision authored, so nothing to reject and no way
 * back. Measured on a real sweep: an unrelated `insert_table` rewrote 13% to
 * 8.75% and the user had no undo.
 *
 * "Nothing was edited in this snapshot" is not the same claim as "the
 * occurrences agree", and conflating them is what loses the value.
 */
import { applyRules } from '../engine';
import { scanBindings } from '../sfdtAdapter';

const field = (name: string, text: string) => ({
  contentControlProperties: { tag: `[[name=${name}|type=percent]]` },
  inlines: [{ text }]
});

/** One name, two values - the shape the sweep found leaking. */
const divergentDoc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [field('tax_rate', '8.75%')] },
        { inlines: [field('tax_rate', '13%')] }
      ]
    }
  ]
});

const valuesOf = (sfdt: any): string[] =>
  scanBindings(sfdt)
    .occurrences.filter((occurrence: any) => occurrence.def.name === 'tax_rate')
    .map((occurrence: any) => occurrence.text);

describe('a field whose occurrences disagree', () => {
  it('refuses to arbitrate when there is no previous snapshot', () => {
    // The behaviour that is already correct, pinned so the fix below cannot
    // regress it.
    const result = applyRules(divergentDoc() as any, {});
    expect(
      result.diagnostics.some((d: any) => d.code === 'ambiguous-edit')
    ).toBe(true);
    expect(valuesOf(result.sfdt).sort()).toEqual(['13%', '8.75%']);
  });

  it('still refuses when a snapshot exists and nothing was edited', () => {
    const doc = divergentDoc();
    const base = applyRules(doc as any, {});

    // Nothing changed between the snapshots. The disagreement is not an edit
    // to arbitrate; it is a document that never satisfied the claim its own
    // binding name makes.
    const result = applyRules(doc as any, { prevValues: base.values });

    expect(valuesOf(result.sfdt).sort()).toEqual(['13%', '8.75%']);
    expect(
      result.diagnostics.some((d: any) => d.code === 'ambiguous-edit')
    ).toBe(true);
  });

  it('leaves a genuine edit working', () => {
    // The guard must not cost the feature: when the occurrences DO agree and
    // one is edited, the new value still fans out to the others.
    const doc = {
      sections: [
        {
          blocks: [
            { inlines: [field('tax_rate', '8.5%')] },
            { inlines: [field('tax_rate', '8.5%')] }
          ]
        }
      ]
    };
    const base = applyRules(doc as any, {});
    const edited = JSON.parse(JSON.stringify(base.sfdt));
    edited.sections[0].blocks[0].inlines[0].inlines[0].text = '11%';

    const result = applyRules(edited, { prevValues: base.values });
    expect(valuesOf(result.sfdt)).toEqual(['11%', '11%']);
  });
});
