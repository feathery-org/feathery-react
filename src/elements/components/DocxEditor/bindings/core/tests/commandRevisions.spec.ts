import { authorCommandRevisions } from '../commandRevisions';
import {
  getAt,
  scanBindings,
  setOccurrenceText
} from '../sfdtAdapter';
import { SfdtDocument } from '../sfdtTypes';

describe('authorCommandRevisions', () => {
  it('authors a cell-level binding change in its paragraph inlines', () => {
    const before = {
      sections: [
        {
          blocks: [
            {
              rows: [
                {
                  cells: [
                    {
                      contentControlProperties: { tag: '[[name=amount]]' },
                      blocks: [
                        {
                          inlines: [
                            {
                              text: 'Before',
                              characterFormat: { bold: true }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    } as SfdtDocument;
    const occurrence = scanBindings(before).fields.get('amount')![0];
    const after = setOccurrenceText(before, occurrence, 'After');

    const result = authorCommandRevisions(before, after, {
      author: 'Robin',
      changeSetId: 'cell-binding',
      group: 'amount'
    });
    const cell = getAt(result, occurrence.path);

    expect(cell.inlines).toBeUndefined();
    expect(cell.blocks[0].inlines).toEqual([
      expect.objectContaining({
        text: 'Before',
        characterFormat: { bold: true },
        revisionIds: [expect.any(String)]
      }),
      expect.objectContaining({
        text: 'After',
        characterFormat: { bold: true },
        revisionIds: [expect.any(String)]
      })
    ]);
    expect(result.revisions).toEqual([
      expect.objectContaining({ revisionType: 'Deletion' }),
      expect.objectContaining({ revisionType: 'Insertion' })
    ]);
  });
});
