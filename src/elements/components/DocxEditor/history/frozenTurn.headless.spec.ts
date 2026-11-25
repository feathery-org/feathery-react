import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { HistoryLane, startHistoryLane } from './tests/headless/historyLane';

const proposal = fs.readFileSync(
  path.join(
    __dirname,
    '../../../../robin/document/formats/docx-sfdt/tests/corpus',
    'flagship-v4b.sfdt.json'
  ),
  'utf8'
);

const docxText = async (base64: string) => {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  return xml.replace(/<[^>]+>/g, '');
};

describe('a Robin turn that never settles, in the real editor', () => {
  let session: HistoryLane;
  beforeAll(async () => {
    session = await startHistoryLane();
  });
  afterAll(async () => {
    await session?.close();
  });

  it('keeps every Robin write saved, and shows the latest in Current version after a reload', async () => {
    await session.call('openFrozenTurn', proposal);
    try {
      // The person's edit saves and checkpoints with highlights.
      await session.call('personTypes', ' Person note.');
      expect(await session.call('waitForSaves', 1)).toBe(true);

      // Robin's turn starts and never ends (the frozen turn in the ticket).
      await session.call('robinTurnStarts');
      await session.call('robinWrites', ' Robin first write.');
      expect(await session.call('waitForSaves', 2)).toBe(true);
      await session.call('robinWrites', ' Robin second write.');
      expect(await session.call('waitForSaves', 3)).toBe(true);

      const state = await session.call('frozenTurnState');
      // Saved mid-turn without closing the version.
      expect(state.saves).toHaveLength(3);
      expect(state.saves.every((s: any) => !s.closeSession)).toBe(true);
      expect(new Set(state.saves.map((s: any) => s.sessionId)).size).toBe(1);
      // The host received a DOCX holding both of Robin's writes.
      const saved = await docxText(state.docxBase64);
      expect(saved).toContain('Person note.');
      expect(saved).toContain('Robin first write.');
      expect(saved).toContain('Robin second write.');
      // The first checkpoint has highlights; mid-turn ones carry only the
      // document, and the stored one matches the latest save.
      expect(state.checkpoints.map((c: any) => c.hasChanges)).toEqual([
        true,
        false,
        false
      ]);
      expect(state.storedFinal).toContain('Robin second write.');

      const current = await session.call('currentVersionAfterReload');
      expect(current?.sfdt).toContain('Robin second write.');
    } finally {
      await session.call('closeFrozenTurn');
    }
  });
});
