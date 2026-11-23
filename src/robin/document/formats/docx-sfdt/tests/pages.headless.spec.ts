/** Page outlines start where the editor's own go-to-page does and hold only what is on their page */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  turn += 1;
  const out = await lane.call<any>('dispatch', verb, { turnId: `pg-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out));
  return out.result;
};
const startOf = (page: string): { id: string; offset: number } => {
  const m = /starts in (n\d+) at character (\d+)/.exec(page);
  if (!m) throw new Error(page);
  return { id: m[1], offset: Number(m[2]) };
};
const lineIds = (lines: string) => lines.split('\n').map((l) => l.trim().split(' ')[0]);
const bodyIds = (lines: string) => {
  let outside: number | null = null;
  return lines.split('\n').flatMap((line) => {
    const indent = line.length - line.trimStart().length;
    if (outside !== null && indent > outside) return [];
    outside = /^\s*\w+:$/.test(line) && line.trim() !== 'body:' ? indent : null;
    return outside === null ? [line.trim().split(' ')[0]] : [];
  });
};

const p = (text: string) => ({ paragraphFormat: {}, characterFormat: {}, inlines: [{ characterFormat: {}, text }] });
const cell = (blocks: any[]) => ({ blocks, cellFormat: { preferredWidth: 234, preferredWidthType: 'Point', cellWidth: 234 } });
const row = (texts: string[], rowFormat: Record<string, unknown> = {}) => ({
  rowFormat: { height: 1, heightType: 'AtLeast', allowBreakAcrossPages: true, isHeader: false, ...rowFormat },
  cells: texts.map((t) => cell([p(t)]))
});
const control = (blocks: any[]) => ({
  blocks,
  contentControlProperties: { lockContentControl: false, lockContents: false, tag: '', color: '#00000000', title: '', type: 'RichText', hasPlaceHolderText: false, multiline: false, isTemporary: false, characterFormat: {}, contentControlListItems: [] }
});
const table = (...cells: string[]) => ({ grid: [234, 234], tableFormat: {}, rows: [row(cells.slice(0, 2)), row(cells.slice(2))] });
const sentence = 'This sentence fills a paragraph that runs across a page break. ';
const doc = JSON.stringify({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
      blocks: [
        ...Array.from({ length: 30 }, (_, i) => p(`Opening paragraph ${i + 1}`)),
        p(sentence.repeat(60)),
        {
          grid: [234, 234],
          tableFormat: {},
          rows: [row(['Header A', 'Header B'], { isHeader: true }), ...Array.from({ length: 70 }, (_, i) => row([`Row ${i + 1}`, `Value ${i + 1}`]))]
        },
        p('Between the tables'),
        {
          grid: [234, 234],
          tableFormat: {},
          rows: [{ ...row(['Tall', 'Tall']), cells: [cell(Array.from({ length: 90 }, (_, i) => p(`Cell line ${i + 1}`))), cell([p('Beside')])] }]
        },
        p('Closing paragraph')
      ],
      headersFooters: {}
    }
  ]
});

describe('page starts agree with the editor', () => {
  it('on a real proposal, every page starts where go-to-page puts the caret', async () => {
    await lane.call('open', flagship);
    const shown = await lane.call<Array<number | null>>('shownNumbers');
    const numbered = shown.some((n) => n !== null);
    expect(shown.length).toBeGreaterThan(3);
    expect((await lane.call<any>('descriptor')).pageCount).toBe(shown.length);
    for (let laidOut = 1; laidOut <= shown.length; laidOut += 1) {
      const outline = await dispatch('outline', { pagePosition: laidOut });
      expect(outline).toEqual(expect.objectContaining({ ok: true }));
      const number = shown[laidOut - 1];
      if (numbered && number !== null) expect((await dispatch('outline', { pageNumber: number })).page).toBe(outline.page);
      await lane.call('goToPage', laidOut);
      const { selection } = await lane.call<any>('descriptor');
      expect([laidOut, startOf(outline.page)]).toEqual([laidOut, selection.start]);
    }
  });
});

describe('a page named by the page number it shows', () => {
  const footer = { footer: { blocks: [{ paragraphFormat: {}, characterFormat: {}, inlines: [{ fieldType: 0, hasFieldEnd: true }, { text: 'PAGE' }, { fieldType: 2 }, { text: '1' }, { fieldType: 1 }] }] } };
  const numberedDoc = JSON.stringify({
    sections: [
      { sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 }, blocks: [p('Cover page')], headersFooters: {} },
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72, breakCode: 'NewPage', restartPageNumbering: true, pageStartingNumber: 1 },
        blocks: Array.from({ length: 60 }, (_, i) => p(`Numbered paragraph ${i + 1}`)),
        headersFooters: footer
      }
    ]
  });

  it('is the page its footer numbers, past an unnumbered cover', async () => {
    await lane.call('open', numberedDoc);
    const shown = await lane.call<Array<number | null>>('shownNumbers');
    expect(shown.slice(0, 3)).toEqual([null, 1, 2]);
    const first = await dispatch('outline', { pageNumber: 1 });
    expect(startOf(first.page)).toEqual({ id: await lane.call<string>('idAt', ['sections', 1, 'blocks', 0]), offset: 0 });
    expect(startOf((await dispatch('outline', { pagePosition: 2 })).page)).toEqual(startOf(first.page));
    expect(startOf((await dispatch('outline', { pagePosition: 1 })).page).id).toBe(await lane.call<string>('idAt', ['sections', 0, 'blocks', 0]));
    const unshown = await dispatch('outline', { pageNumber: shown.length });
    expect(unshown).toEqual(expect.objectContaining({ ok: false, refusal: expect.objectContaining({ invariant: 'page-range' }) }));
    const both = await dispatch('outline', { pageNumber: 1, pagePosition: 2 });
    expect(both).toEqual(expect.objectContaining({ ok: false, refusal: expect.objectContaining({ invariant: 'envelope' }) }));
  });

  it.each(['Inline', 'InFrontOfText'])('reads the page number a footer prints from a text box laid out %s', async (wrapping) => {
    const field = { paragraphFormat: {}, characterFormat: {}, inlines: [{ fieldType: 0, hasFieldEnd: true }, { text: 'PAGE' }, { fieldType: 2 }, { text: '5' }, { fieldType: 1 }] };
    const textBox = { characterFormat: {}, shapeId: 1, visible: true, width: 120, height: 30, widthScale: 100, heightScale: 100, verticalPosition: 0, verticalOrigin: 'Paragraph', horizontalPosition: 0, horizontalOrigin: 'Column', zOrderPosition: 1, allowOverlap: true, textWrappingStyle: wrapping, textWrappingType: 'Both', autoShapeType: 'Rectangle', textFrame: { textVerticalAlignment: 'Top', leftMargin: 7, rightMargin: 7, topMargin: 7, bottomMargin: 7, blocks: [field] } };
    const fromFive = JSON.stringify({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72, restartPageNumbering: true, pageStartingNumber: 5 },
          blocks: Array.from({ length: 60 }, (_, i) => p(`Numbered paragraph ${i + 1}`)),
          headersFooters: { footer: { blocks: [{ paragraphFormat: {}, characterFormat: {}, inlines: [textBox] }] } }
        }
      ]
    });
    await lane.call('open', fromFive);
    expect((await lane.call<Array<number | null>>('shownNumbers')).slice(0, 2)).toEqual([5, 6]);
    expect((await dispatch('outline', { pageNumber: 5 })).page).toContain('Page 1 of');
  });

  it('asks which page when restarted numbering shows that number twice', async () => {
    const restarted = JSON.parse(numberedDoc);
    restarted.sections.push({ ...restarted.sections[1], blocks: [p('Appendix')] });
    await lane.call('open', JSON.stringify(restarted));
    const shown = await lane.call<Array<number | null>>('shownNumbers');
    const ones = shown.flatMap((n, i) => (n === 1 ? [i + 1] : []));
    expect(ones.length).toBe(2);
    const refused = await dispatch('outline', { pageNumber: 1 });
    expect(refused).toEqual(expect.objectContaining({ ok: false, refusal: expect.objectContaining({ invariant: 'page-ambiguous' }) }));
    for (const position of ones) expect((await dispatch('outline', { pagePosition: position })).ok).toBe(true);
  });
});

describe('a page outline', () => {
  beforeAll(async () => {
    await lane.call('open', doc);
  });

  it('starts inside a paragraph that runs across the page break', async () => {
    const pageCount = await lane.call<number>('pageCount');
    const outlines = [];
    for (let page = 1; page <= pageCount; page += 1) outlines.push(await dispatch('outline', { pagePosition: page }));
    const long = await lane.call<string>('idAt', ['sections', 0, 'blocks', 30]);
    const split = outlines.findIndex((o) => startOf(o.page).id === long && startOf(o.page).offset > 0);
    expect(split).toBeGreaterThan(0);
    // the paragraph shows on both pages it is laid out on
    expect(lineIds(outlines[split - 1].lines)).toContain(long);
    expect(lineIds(outlines[split].lines)).toContain(long);
    expect(outlines[split - 1].page).toContain(`Page ${split + 1} starts in ${long}`);
  });

  it('starts a continued table past its repeated header row', async () => {
    const pageCount = await lane.call<number>('pageCount');
    const table = await lane.call<string>('idAt', ['sections', 0, 'blocks', 31]);
    const header = await lane.call<string>('idAt', ['sections', 0, 'blocks', 31, 'rows', 0]);
    const rows = (await dispatch('read', { ids: [table] })).nodes[0].rows.map((r: any) => r.id);
    const continued = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const outline = await dispatch('outline', { pagePosition: page });
      const ids = lineIds(outline.lines);
      if (ids.includes(table) && !ids.includes(header)) continued.push({ outline, ids });
    }
    expect(continued.length).toBeGreaterThan(0);
    for (const { outline, ids } of continued) {
      const start = startOf(outline.page);
      const startRow = rows.findIndex((r: string) => ids.includes(r));
      const read = (await dispatch('read', { ids: [rows[startRow]] })).nodes[0];
      expect(read.cells[0].blocks[0].id).toBe(start.id);
      expect(startRow).toBeGreaterThan(0);
    }
  });

  it('holds every cell of a row that breaks across pages on the page that lays it out', async () => {
    const pageCount = await lane.call<number>('pageCount');
    const cells = (await dispatch('read', { ids: [await lane.call<string>('idAt', ['sections', 0, 'blocks', 33, 'rows', 0])] })).nodes[0].cells;
    const [firstLine, beside] = [cells[0].blocks[0].id, cells[1].blocks[0].id];
    const onPages = { firstLine: [] as number[], beside: [] as number[] };
    for (let page = 1; page <= pageCount; page += 1) {
      const ids = lineIds((await dispatch('outline', { pagePosition: page, depth: 6 })).lines);
      if (ids.includes(firstLine)) onPages.firstLine.push(page);
      if (ids.includes(beside)) onPages.beside.push(page);
    }
    expect(onPages.beside).toEqual(onPages.firstLine);
  });

  it('holds only what is laid out on its page', async () => {
    const first = await dispatch('outline', { pagePosition: 1 });
    const second = await dispatch('outline', { pagePosition: 2 });
    const secondStart = startOf(second.page);
    expect(startOf(first.page)).toEqual({ id: await lane.call<string>('idAt', ['sections', 0, 'blocks', 0]), offset: 0 });
    if (secondStart.offset === 0) expect(lineIds(first.lines)).not.toContain(secondStart.id);
    const last = await lane.call<string>('idAt', ['sections', 0, 'blocks', 34]);
    expect(lineIds(first.lines)).not.toContain(last);
  });

  it('refuses a page past the end and keeps the outline hash of the whole document', async () => {
    const pageCount = await lane.call<number>('pageCount');
    const whole = await dispatch('outline', {});
    const page = await dispatch('outline', { pagePosition: 1 });
    expect(page.outlineHash).toBe(whole.outlineHash);
    expect((await lane.call<any>('descriptor')).pageCount).toBe(pageCount);
    const past = await dispatch('outline', { pagePosition: pageCount + 1 });
    expect(past).toEqual(expect.objectContaining({ ok: false, refusal: expect.objectContaining({ invariant: 'page-range' }) }));
  });

  it('starts in every cell a row carries over mid-paragraph', async () => {
    const twoCut = JSON.parse(doc);
    twoCut.sections[0].blocks = [
      { grid: [234, 234], tableFormat: {}, rows: [{ ...row(['', '']), cells: [cell([p(sentence.repeat(60))]), cell([p(sentence.repeat(60))])] }] }
    ];
    await lane.call('open', JSON.stringify(twoCut));
    const [left, right] = [await lane.call<string>('idAt', ['sections', 0, 'blocks', 0, 'rows', 0, 'cells', 0, 'blocks', 0]), await lane.call<string>('idAt', ['sections', 0, 'blocks', 0, 'rows', 0, 'cells', 1, 'blocks', 0])];
    const first = await dispatch('outline', { pagePosition: 1 });
    expect(first.page).toMatch(new RegExp(`Page 2 starts in ${left} at character [1-9]\\d* and ${right} at character [1-9]`));
  });
});

describe('a document read and written through the editor', () => {
  const controls = JSON.stringify({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
        blocks: [
          p('Alpha'),
          control([p('Bravo')]),
          control([p('Charlie'), p('Delta')]),
          control([control([p('Echo')]), p('Foxtrot')]),
          control([table('Mikey', 'November', 'Oscar', 'Papa')]),
          control([p('Romeo'), table('Sierra', 'Tango', 'Uniform', 'Victor')]),
          ...Array.from({ length: 50 }, (_, i) => p(`After ${i + 1}`))
        ],
        headersFooters: {}
      }
    ]
  });
  const documents = [
    ['a real proposal', flagship],
    ['content controls of every shape', controls]
  ];
  const ownText = (node: any): string => (node.kind === 'run' ? String(node.text ?? '') : (node.inlines ?? []).map(ownText).join(''));

  it.each(documents)('puts every body node on some page in %s', async (_, sfdt) => {
    await lane.call('open', sfdt);
    const whole = new Set(bodyIds((await dispatch('outline', { depth: 6 })).lines));
    const onPages = new Set<string>();
    const pageCount = await lane.call<number>('pageCount');
    for (let page = 1; page <= pageCount; page += 1)
      for (const id of lineIds((await dispatch('outline', { pagePosition: page, depth: 6 })).lines)) onPages.add(id);
    expect([...whole].filter((id) => !onPages.has(id))).toEqual([]);
  });

  it.each(documents)('selects in %s where the editor finds each word', async (_, sfdt) => {
    await lane.call('open', sfdt);
    const ids = bodyIds((await dispatch('outline', { depth: 6 })).lines).filter((id) => /^n\d+$/.test(id));
    const read: any[] = [];
    for (let i = 0; i < ids.length; i += 40) read.push(...(await dispatch('read', { ids: ids.slice(i, i + 40) })).nodes);
    const all = (node: any): any[] => [node, ...['blocks', 'rows', 'cells', 'inlines'].flatMap((key) => (node[key] ?? []).flatMap(all))];
    const texts = new Map(read.flatMap(all).filter((n) => n.kind === 'paragraph').map((n) => [n.id, ownText(n)]));
    const serialized = (await lane.call<string>('serialize')).toLowerCase();
    const isUnique = (word: string) => serialized.split(word.toLowerCase()).length === 2;
    const misplaced = [];
    let checked = 0;
    for (const [id, text] of texts) {
      const word = (text.match(/[A-Za-z]{4,}/g) ?? []).find(isUnique);
      if (!word) continue;
      const found = await lane.call<{ start: string }>('selectFound', word);
      const { selection } = await lane.call<any>('descriptor');
      checked += 1;
      const want = { id, offset: text.indexOf(word) };
      // The engine maps no position inside a text box, so a selection there is none
      if (selection === undefined && /;S;/.test(found.start)) continue;
      if (selection?.start.id !== want.id || selection?.start.offset !== want.offset) misplaced.push({ word, want, got: selection?.start });
    }
    expect(checked).toBeGreaterThan(10);
    expect(misplaced).toEqual([]);
  });

  it('edits a paragraph after a control holding several blocks in place', async () => {
    await lane.call('open', controls);
    const after = await lane.call<string>('idAt', ['sections', 0, 'blocks', 6]);
    const run = (await dispatch('read', { ids: [after] })).nodes[0].inlines[0];
    const written = await dispatch('write', { intent: 'Extend the first closing paragraph', scope: { ids: [after] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { id: run.id, kind: 'run', text: 'After 1 extended' } }] });
    expect(written.ok).toBe(true);
    const texts = (await dispatch('find', { text: 'extended' })).hits.map((hit: any) => hit.id);
    expect(texts).toEqual([after]);
  });
});
