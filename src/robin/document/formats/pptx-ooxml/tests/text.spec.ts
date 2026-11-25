import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PptxEditorEngine } from '../../../../../elements/components/PptxEditor/engine/PptxEditorEngine';
import { conformanceProblems } from '../../../pack';
import { createHost, pptxPack } from '../index';
import { themeColorKey, serializeDeck, writeNative } from '../native';
import { parseXml } from '../../../../../elements/components/PptxEditor/core/opc/xml';
import { fixture, openDeck, type WriteResult } from './harness';

function expectCard(result: WriteResult) {
  expect(result).toEqual(
    expect.objectContaining({ ok: true, committed: true, landed: 'card' })
  );
  expect(result.trace.proof).toEqual(
    expect.objectContaining({ outcome: 'passed' })
  );
}

function replaceParagraph(
  deck: ReturnType<typeof openDeck>,
  id: string,
  node: Record<string, unknown>,
  turnId = 'turn-1'
) {
  return deck.write(
    {
      intent: 'Edit the subtitle.',
      scope: { ids: [id] },
      changes: [{ kind: 'replace', id, base: deck.read(id, turnId).base, node }]
    },
    turnId
  );
}

const subtitle = (deck: ReturnType<typeof openDeck>) => {
  const hit = deck.find('Company Name')[0];
  const run = (deck.read(hit.id).runs as Array<{ id: string }>)[0].id;
  return { run, paragraph: hit.id, shape: hit.within[0] };
};

describe('PowerPoint text', () => {
  it('adds a run that continues the formatting of the text before it', () => {
    const deck = openDeck();
    const { run, paragraph } = subtitle(deck);
    const before = deck.read(run) as Record<string, unknown>;
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...deck.read(paragraph),
        runs: [{ ...before, text: 'Acme' }, { text: ' Corp' }]
      })
    );
    const runs = deck.read(paragraph).runs as Array<Record<string, unknown>>;
    const after = runs[1];
    expect(after.text).toBe(' Corp');
    for (const key of ['bold', 'italic', 'size', 'color', 'font'])
      expect(after[key]).toEqual(before[key]);
    expect(deck.pending()).toHaveLength(1);
    expect(deck.engine.snapshot().undoDepth).toBe(1);
  });

  it('formats one run and adds a paragraph in one card', () => {
    const deck = openDeck();
    const { run, paragraph, shape } = subtitle(deck);
    const shapeNode = deck.read(shape);
    expectCard(
      deck.write({
        intent: 'Bold the client name and add the quarter under it.',
        scope: { ids: [shape] },
        changes: [
          {
            kind: 'replace',
            id: shape,
            base: shapeNode.base,
            node: {
              ...shapeNode,
              paragraphs: [
                {
                  ...deck.read(paragraph),
                  runs: [{ ...deck.read(run), bold: true, size: 20 }]
                },
                { runs: [{ text: 'Q3 2026' }], align: 'r' }
              ]
            }
          }
        ]
      })
    );
    const lines = (deck.read(shape).paragraphs as any[]).map((p) => ({
      align: p.align,
      runs: p.runs.map((r: any) => [r.text, r.bold, r.size])
    }));
    expect(lines[0].runs[0]).toEqual(['Company Name', true, 20]);
    expect(lines[1]).toEqual(
      // the new line continues the subtitle's own formatting, not the bold just applied
      { align: 'r', runs: [['Q3 2026', undefined, undefined]] }
    );
    expect(deck.pending()).toHaveLength(1);
  });

  it('edits text inside a group', () => {
    const deck = openDeck('template1-text-group.pptx');
    const groups = ((deck.call('outline', { depth: 2 }) as any).lines as string)
      .split('\n')
      .filter((line) => / group /.test(line))
      .map((line) => line.trim().split(' ')[0]);
    const firstRun = (node: any): any =>
      node.kind === 'run'
        ? node
        : [
            ...(node.shapes ?? []),
            ...(node.paragraphs ?? []),
            ...(node.runs ?? [])
          ]
            .map(firstRun)
            .find(Boolean);
    const run = groups.map((id) => firstRun(deck.read(id))).find(Boolean);
    expect(run).toBeDefined();
    expectCard(
      deck.write({
        intent: 'Rename the grouped label.',
        scope: { ids: [run.id] },
        changes: [
          {
            kind: 'replace',
            id: run.id,
            base: deck.read(run.id).base,
            node: { ...deck.read(run.id), text: 'Renamed' }
          }
        ]
      })
    );
    expect(deck.find('Renamed')).toHaveLength(1);
  });

  it('bolds part of a run from a find hit, splitting it', () => {
    const deck = openDeck();
    const hit = deck.find('Name')[0] as {
      id: string;
      span: { start: number; end: number };
    };
    expectCard(
      deck.write({
        intent: 'Bold the word Name.',
        scope: { ids: [hit.id] },
        changes: [
          {
            kind: 'set',
            target: {
              id: hit.id,
              shape: deck.read(hit.id).shape,
              match: { text: 'Name', span: hit.span }
            },
            props: { bold: true }
          }
        ]
      })
    );
    const runs = (deck.read(hit.id).runs as Array<Record<string, unknown>>).map(
      (run) => [run.text, run.bold]
    );
    expect(runs).toEqual([
      ['Company ', undefined],
      ['Name', true]
    ]);
  });

  it('finds and removes a highlight written as a theme colour', () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const slidePath = 'ppt/slides/slide1.xml';
    files[slidePath] = strToU8(
      strFromU8(files[slidePath]).replace(
        '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
        '<a:rPr lang="en"><a:highlight><a:schemeClr val="accent1"/></a:highlight></a:rPr><a:t>Marketing Plan Presentation'
      )
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    const find = { feature: { name: 'highlight' } };
    const found = deck.call('find', find) as {
      total: number;
      shape: string;
    };
    expect(found.total).toBe(1);
    expectCard(
      deck.write({
        intent: 'Remove the highlighting.',
        scope: { ids: [], bulk: [{ find, total: found.total }] },
        changes: [
          {
            kind: 'set',
            target: { find, total: found.total, shape: found.shape },
            props: { highlight: 'none' }
          }
        ]
      })
    );
    for (const record of deck.pending()) deck.engine.acceptChange(record.id);
    expect((deck.call('find', find, 'turn-2') as { total: number }).total).toBe(
      0
    );
    expect(serializeDeck(deck.engine)).not.toContain('a:highlight');
  });

  it('refuses to search by a colour or feature the deck does not write', () => {
    const deck = openDeck();
    for (const value of ['#ffff00', 'yellow'])
      expect(
        deck.call('find', { feature: { name: 'highlight', value } })
      ).toEqual(
        expect.objectContaining({
          ok: false,
          refusal: expect.objectContaining({
            invariant: 'property-invalid',
            destroyed: expect.stringContaining('#RRGGBB in capitals')
          })
        })
      );
    expect(
      deck.call('find', { feature: { name: 'highlight', value: '#FFFF00' } })
    ).toEqual(expect.objectContaining({ ok: true }));
    expect(
      deck.call('find', { feature: { name: 'colour', value: '#FF0000' } })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({
          destroyed: expect.stringContaining('find by color or highlight')
        })
      })
    );
  });

  it('reads no colour for a system-colour highlight that names none', () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const slidePath = 'ppt/slides/slide1.xml';
    files[slidePath] = strToU8(
      strFromU8(files[slidePath]).replace(
        '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
        '<a:rPr lang="en"><a:highlight><a:sysClr val="window"/></a:highlight></a:rPr><a:t>Marketing Plan Presentation'
      )
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    expect(JSON.stringify(deck.call('outline', { depth: 9 }))).not.toMatch(
      /NAN/i
    );
    expect(
      (
        deck.call('find', { feature: { name: 'highlight' } }) as {
          total: number;
        }
      ).total
    ).toBe(0);
  });

  it('reads a theme-coloured highlight in the colour of its own slide', () => {
    const highlight = '<a:highlight><a:schemeClr val="accent1"/></a:highlight>';
    const xml = strFromU8(
      unzipSync(fixture('marketing-parity.pptx'))['ppt/slides/slide1.xml']
    ).replace(
      '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
      `<a:rPr lang="en">${highlight}</a:rPr><a:t>Marketing Plan Presentation`
    );
    const [first, second] = ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'];
    const key = (path: string) => themeColorKey(path, parseXml(highlight)[0]);
    const { nf } = pptxPack.adapter.toNormalForm(
      writeNative({
        slides: [
          { path: first, xml },
          { path: second, xml }
        ],
        pending: [],
        themeColors: { [key(first)]: '#6AD1FA', [key(second)]: '#4285F4' }
      })
    );
    const shown = JSON.stringify(nf.root).match(/"highlight":"#[0-9A-F]{6}"/g);
    expect(shown).toEqual(['"highlight":"#6AD1FA"', '"highlight":"#4285F4"']);
  });

  const injected = (
    slide: string,
    from: string,
    to: string
  ): ReturnType<typeof openDeck> => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const path = `ppt/slides/${slide}.xml`;
    files[path] = strToU8(strFromU8(files[path]).replace(from, to));
    return openDeck('marketing-parity.pptx', zipSync(files));
  };
  const total = (deck: ReturnType<typeof openDeck>, query: object) =>
    (deck.call('find', query) as { total: number }).total;

  it('finds text by the theme colour it shows', () => {
    const deck = injected(
      'slide1',
      '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
      '<a:rPr lang="en"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>Marketing Plan Presentation'
    );
    const accent = { feature: { name: 'color', value: '#6AD1FA' } };
    expect(total(deck, accent)).toBe(
      total(openDeck('marketing-parity.pptx'), accent) + 1
    );
  });

  it('matches no slide number field or empty run by colour or highlight', () => {
    const deck = injected(
      'slide24',
      '<a:rPr lang="en"/><a:t>‹#›</a:t></a:fld>',
      '<a:rPr lang="en"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>‹#›</a:t></a:fld><a:r><a:rPr lang="en"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t></a:t></a:r>'
    );
    expect(total(deck, { feature: { name: 'color', value: '#FF0000' } })).toBe(
      0
    );
    expect(total(deck, { feature: { name: 'highlight' } })).toBe(0);
  });

  it('suggests no change to text whose highlight is cleared when it had none', () => {
    const deck = injected(
      'slide1',
      '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
      '<a:rPr lang="en"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>Marketing Plan Presentation'
    );
    const find = { kind: 'run' };
    const found = deck.call('find', find) as { total: number; shape: string };
    expectCard(
      deck.write({
        intent: 'Remove every highlight.',
        scope: { ids: [], bulk: [{ find, total: found.total }] },
        changes: [
          {
            kind: 'set',
            target: { find, total: found.total, shape: found.shape },
            props: { highlight: 'none' }
          }
        ]
      })
    );
    const [card] = deck.pending();
    expect(new Set(card.targets.map((target) => target.shapeId)).size).toBe(1);
  });

  it('clears the highlight on text the deck holds with a line break in it', () => {
    const deck = injected(
      'slide1',
      '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
      '<a:rPr lang="en"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>Marketing Plan\nPresentation'
    );
    const find = { feature: { name: 'highlight' } };
    const found = deck.call('find', find) as { total: number; shape: string };
    expectCard(
      deck.write({
        intent: 'Remove every highlight.',
        scope: { ids: [], bulk: [{ find, total: found.total }] },
        changes: [
          {
            kind: 'set',
            target: { find, total: found.total, shape: found.shape },
            props: { highlight: 'none' }
          }
        ]
      })
    );
    expect(total(deck, find)).toBe(0);
    expect(deck.find('Marketing Plan\nPresentation')).toHaveLength(1);
  });

  it('refuses a new run written without its text', () => {
    const deck = openDeck();
    const { paragraph } = subtitle(deck);
    const node = deck.read(paragraph);
    const result = replaceParagraph(deck, paragraph, {
      ...node,
      runs: [...(node.runs as object[]), { kind: 'run', bold: true }]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          message: expect.stringContaining('is not one line of text')
        })
      })
    );
  });

  it('reports no change, and no card, for clearing a highlight nothing has', () => {
    const deck = openDeck('marketing-parity.pptx');
    const find = { text: 'Company Name' };
    const found = deck.call('find', find) as { total: number; shape: string };
    const result = deck.write({
      intent: 'Remove the highlight.',
      scope: { ids: [], bulk: [{ find, total: found.total }] },
      changes: [
        {
          kind: 'set',
          target: { find, total: found.total, shape: found.shape },
          props: { highlight: 'none' }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, committed: false })
    );
    expect(deck.pending()).toHaveLength(0);
  });

  it('round-trips a deck with a theme highlight byte for byte', () => {
    const deck = injected(
      'slide1',
      '<a:rPr lang="en"/><a:t>Marketing Plan Presentation',
      '<a:rPr lang="en"><a:highlight><a:schemeClr val="accent1"/></a:highlight></a:rPr><a:t>Marketing Plan Presentation'
    );
    expect(
      conformanceProblems(pptxPack, { deck: serializeDeck(deck.engine) })
    ).toEqual([]);
  });

  it('takes the underline off underlined text', () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const slidePath = 'ppt/slides/slide1.xml';
    files[slidePath] = strToU8(
      strFromU8(files[slidePath]).replace(
        '<a:rPr lang="en"/><a:t>Company Name',
        '<a:rPr lang="en" u="sng"/><a:t>Company Name'
      )
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    const { run } = subtitle(deck);
    expect(deck.read(run).underline).toBe(true);
    expectCard(
      deck.write({
        intent: 'Remove the underline.',
        scope: { ids: [run] },
        changes: [
          {
            kind: 'replace',
            id: run,
            base: deck.read(run).base,
            node: { ...deck.read(run), underline: false }
          }
        ]
      })
    );
    expect(deck.read(run).underline).toBe(false);
  });

  it('takes the highlight off highlighted text, and refuses dropping it instead', () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const slidePath = 'ppt/slides/slide1.xml';
    files[slidePath] = strToU8(
      strFromU8(files[slidePath]).replace(
        '<a:rPr lang="en"/><a:t>Company Name',
        '<a:rPr lang="en"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>Company Name'
      )
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    const { run, paragraph } = subtitle(deck);
    const highlighted = deck.read(run);
    expect(highlighted.highlight).toBe('#FFFF00');

    const { highlight: _dropped, ...withoutHighlight } = highlighted;
    expect(
      deck.write({
        intent: 'Remove the highlight.',
        scope: { ids: [run] },
        changes: [
          {
            kind: 'replace',
            id: run,
            base: highlighted.base,
            node: withoutHighlight
          }
        ]
      })
    ).toEqual(expect.objectContaining({ ok: false }));

    expectCard(
      deck.write({
        intent: 'Remove the highlight.',
        scope: { ids: [paragraph] },
        changes: [
          {
            kind: 'set',
            target: { ids: [run], shape: { [run]: highlighted.shape } },
            props: { highlight: 'none' }
          }
        ]
      })
    );
    expect(deck.read(run).highlight).toBeUndefined();
    expect(deck.read(run).text).toBe(highlighted.text);
  });

  it.each([
    ['no fill', '<a:noFill/>'],
    [
      'a gradient',
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="00FF00"/></a:gs></a:gsLst></a:gradFill>'
    ]
  ])('colours text that had %s', (_, fill) => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const slidePath = 'ppt/slides/slide1.xml';
    files[slidePath] = strToU8(
      strFromU8(files[slidePath]).replace(
        '<a:rPr lang="en"/><a:t>Company Name',
        `<a:rPr lang="en">${fill}</a:rPr><a:t>Company Name`
      )
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    const { run, paragraph } = subtitle(deck);
    expectCard(
      deck.write({
        intent: 'Colour the subtitle.',
        scope: { ids: [paragraph] },
        changes: [
          {
            kind: 'set',
            target: { ids: [run], shape: { [run]: deck.read(run).shape } },
            props: { color: '#FF00AA' }
          }
        ]
      })
    );
    expect(deck.read(run).color).toBe('#FF00AA');
  });

  it('reports formatting the layout gives a run as inherited', () => {
    const deck = openDeck();
    const { run } = subtitle(deck);
    const node = (
      deck.call('read', { ids: [run], properties: true }) as {
        nodes: Array<{
          properties: Record<string, { value: unknown; source: string }>;
        }>;
      }
    ).nodes[0];
    expect(node.properties.size).toEqual({ value: 12, source: 'container' });
    expect(node.properties.underline).toEqual({
      value: null,
      source: 'default'
    });
  });

  it('keeps a heading its own formatting when its wording is rewritten', () => {
    const deck = openDeck();
    const heading = deck.find('Pain points')[0].id;
    expectCard(
      replaceParagraph(deck, heading, {
        ...deck.read(heading),
        runs: [{ text: 'Main obstacles' }]
      })
    );
    const [run] = deck.read(heading).runs as Array<Record<string, unknown>>;
    expect(run).toEqual(
      expect.objectContaining({ text: 'Main obstacles', bold: true })
    );
  });

  it('leaves new text in an empty title to the formatting its layout gives it', () => {
    const deck = openDeck('sample.pptx');
    const outline = (deck.call('outline', {}) as { lines: string }).lines;
    const slide = outline.split('\n')[8].trim().split(' ')[0];
    const title = (
      deck.read(slide).shapes as Array<Record<string, unknown>>
    ).find((shape) => shape.placeholder === 'title') as {
      paragraphs: Array<{ id: string }>;
    };
    const paragraph = title.paragraphs[0].id;
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...deck.read(paragraph),
        runs: [{ text: 'Quarterly review' }]
      })
    );
    const [run] = deck.read(paragraph).runs as Array<Record<string, unknown>>;
    expect(run.text).toBe('Quarterly review');
    expect(run.bold).toBeUndefined();
  });

  it('keeps what the person is still typing when Robin writes', () => {
    const deck = openDeck();
    const { shape } = subtitle(deck);
    const slide = deck.find('Company Name')[0].within[1];
    const typed = {
      type: 'replace-rich-text' as const,
      slideId: deck.read(slide).path as string,
      shapeId: deck.read(shape).shapeId as string,
      paragraphs: [
        {
          sourceParagraph: 0,
          runs: [
            {
              text: 'Typed by hand',
              source: { paragraph: 0, run: 0 },
              styleChanged: false
            }
          ]
        }
      ]
    };
    deck.store.setCommitSvgTextEdit(() => {
      deck.store.setCommitSvgTextEdit(null);
      deck.store.executeCommand(typed, 'Edit text');
    });
    const footer = deck.find('‹#›')[0].id;
    expectCard(
      deck.write({
        intent: 'Bold the footer.',
        scope: { ids: [footer] },
        changes: [
          {
            kind: 'set',
            target: {
              ids: [footer],
              shape: { [footer]: deck.read(footer).shape }
            },
            props: { bold: true }
          }
        ]
      })
    );
    expect(deck.find('Typed by hand')).toHaveLength(1);
    expect(deck.find('Company Name')).toHaveLength(0);
  });

  it('edits its own earlier suggestion, and rejecting both newest first restores the deck', () => {
    const deck = openDeck();
    const original = JSON.parse(serializeDeck(deck.engine)).slides;
    const { run } = subtitle(deck);
    const rename = (text: string, turnId: string) => {
      const paragraph = deck.find(
        text === 'Acme' ? 'Company Name' : 'Acme',
        turnId
      )[0].id;
      const id = (deck.read(paragraph, turnId).runs as Array<{ id: string }>)[0]
        .id;
      return deck.write(
        {
          intent: 'Rename the client.',
          scope: { ids: [id] },
          changes: [
            {
              kind: 'replace',
              id,
              base: deck.read(id, turnId).base,
              node: { text }
            }
          ]
        },
        turnId
      );
    };
    expectCard(rename('Acme', 'turn-1'));
    expectCard(rename('Acme Corp', 'turn-2'));
    expect(run).toBeDefined();
    const [first, second] = deck.pending();
    expect(deck.engine.rejectChange(second.id).ok).toBe(true);
    expect(deck.engine.rejectChange(first.id).ok).toBe(true);
    expect(JSON.parse(serializeDeck(deck.engine)).slides).toEqual(original);
  });

  it('refuses clearing a paragraph alignment before trying it', () => {
    const deck = openDeck();
    const { paragraph } = subtitle(deck);
    const { align: _align, ...rest } = deck.read(paragraph);
    const result = replaceParagraph(deck, paragraph, rest);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({
          invariant: 'limits',
          read: ['limits']
        })
      })
    );
    expect(deck.pending()).toHaveLength(0);
  });

  describe('links', () => {
    const slidePath = 'ppt/slides/slide1.xml';
    const A = 'https://a.example.com';
    const B = 'https://b.example.com';
    const run = (text: string, link?: string) =>
      `<a:r><a:rPr lang="en"${
        link ? `><a:hlinkClick r:id="${link}"/></a:rPr>` : '/>'
      }<a:t>${text}</a:t></a:r>`;
    const runWith = (text: string, tags: string) =>
      `<a:r><a:rPr lang="en">${tags}</a:rPr><a:t>${text}</a:t></a:r>`;
    // "Visit " plain, "Docs" linked to A, "Help" linked to B
    const linkedDeck = (
      subtitle = run('Visit ') + run('Docs', 'rIdA') + run('Help', 'rIdB'),
      text = 'Visit DocsHelp'
    ) => {
      const files = unzipSync(fixture('marketing-parity.pptx'));
      const rels = 'ppt/slides/_rels/slide1.xml.rels';
      const relationship = (id: string, target: string) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`;
      files[slidePath] = strToU8(
        strFromU8(files[slidePath]).replace(run('Company Name'), subtitle)
      );
      files[rels] = strToU8(
        strFromU8(files[rels]).replace(
          '</Relationships>',
          `${relationship('rIdA', A)}${relationship('rIdB', B)}</Relationships>`
        )
      );
      const bytes = zipSync(files);
      const deck = openDeck('marketing-parity.pptx', bytes);
      const paragraph = deck.find(text)[0].id;
      return { deck, paragraph, node: deck.read(paragraph), bytes };
    };
    type Node = Record<string, any>;
    const savedSlide = (deck: ReturnType<typeof openDeck>) =>
      (
        JSON.parse(serializeDeck(deck.engine)).slides as Array<{
          path: string;
          xml: string;
        }>
      ).find((part) => part.path === slidePath)!.xml;
    // Each run of the deck's subtitle as saved: its text and the link it carries
    const savedRuns = (deck: ReturnType<typeof openDeck>) =>
      savedSlide(deck)
        .match(/<a:r>.*?<\/a:r>/g)!
        .map((xml) => [
          xml.match(/<a:t>(.*?)<\/a:t>/)?.[1] ?? '',
          xml.match(/hlinkClick r:id="(\w+)"/)?.[1] ?? null
        ])
        .filter(([text]) =>
          /Visit|Docs|Help|^Do$|^cs!?$|draft/.test(String(text))
        );

    it('rebuilds two tooltips on one link exactly', () => {
      const { bytes } = linkedDeck(
        run('Visit ') +
          runWith('Docs', '<a:hlinkClick r:id="rIdA" tooltip="one"/>') +
          runWith('Help', '<a:hlinkClick r:id="rIdA" tooltip="two"/>')
      );
      const engine = new PptxEditorEngine();
      engine.load(bytes);
      expect(
        conformanceProblems(pptxPack, { deck: serializeDeck(engine) })
      ).toEqual([]);
    });

    it('keeps a split piece on the tags of the run it was cut from', () => {
      const second =
        '<a:hlinkClick r:id="rIdA" tooltip="two"/><a:hlinkMouseOver r:id="rIdB"/>';
      const { deck, paragraph } = linkedDeck(
        run('Visit ') +
          runWith('Docs', '<a:hlinkClick r:id="rIdA" tooltip="one"/>') +
          runWith('Help', second)
      );
      expectCard(
        deck.write({
          intent: 'Bold lp.',
          scope: { ids: [paragraph] },
          changes: [
            {
              kind: 'set',
              target: {
                id: paragraph,
                shape: deck.read(paragraph).shape,
                match: { text: 'lp', span: { start: 12, end: 14 } }
              },
              props: { bold: true }
            }
          ]
        })
      );
      const piece = savedSlide(deck)
        .match(/<a:r>.*?<\/a:r>/g)!
        .find((xml) => xml.includes('<a:t>lp</a:t>'));
      expect(piece).toContain(second);
    });

    it('reads linked text as a link holding its runs, with where it goes', () => {
      const { node } = linkedDeck();
      expect(
        (node.runs as Node[]).map((child) =>
          child.kind === 'link'
            ? [child.target, child.runs.map((inner: Node) => inner.text)]
            : child.text
        )
      ).toEqual(['Visit ', [A, ['Docs']], [B, ['Help']]]);
    });

    it('adds text after a link outside it', () => {
      const { deck, paragraph, node } = linkedDeck();
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [...node.runs, { text: ' (draft)' }]
        })
      );
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Docs', 'rIdA'],
        ['Help', 'rIdB'],
        [' (draft)', null]
      ]);
    });

    it('adds a run matching linked text outside the link', () => {
      const { deck, paragraph, node } = linkedDeck();
      const [visit, a, b] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [visit, { text: 'Docs' }, a, b]
        })
      );
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Docs', null],
        ['Docs', 'rIdA'],
        ['Help', 'rIdB']
      ]);
    });

    it('drops both links when the sentence is rewritten as plain text', () => {
      const { deck, paragraph, node } = linkedDeck();
      const [visit] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [{ ...visit, text: 'Visit DocsHelp' }]
        })
      );
      expect(savedRuns(deck)).toEqual([['Visit DocsHelp', null]]);
    });

    it('links the whole sentence when it is rewritten inside one link', () => {
      const { deck, paragraph, node } = linkedDeck();
      const [, a] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [{ ...a, runs: [{ ...a.runs[0], text: 'Visit DocsHelp' }] }]
        })
      );
      expect(savedRuns(deck)).toEqual([['Visit DocsHelp', 'rIdA']]);
    });

    it('keeps text added inside a link in it, formatted or not', () => {
      const { deck, paragraph, node } = linkedDeck();
      const [visit, a, b] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [
            visit,
            {
              ...a,
              runs: [
                { ...a.runs[0], text: 'Do' },
                { text: 'cs!', bold: true }
              ]
            },
            b
          ]
        })
      );
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Do', 'rIdA'],
        ['cs!', 'rIdA'],
        ['Help', 'rIdB']
      ]);
    });

    it('leaves linked text moved to a new paragraph out of the link', () => {
      const { deck } = linkedDeck();
      const shape = deck.find('Visit DocsHelp')[0].within[0];
      const box = deck.read(shape);
      const [first] = box.paragraphs as Node[];
      const [visit, a] = first.runs as Node[];
      expectCard(
        deck.write({
          intent: 'Split the subtitle.',
          scope: { ids: [shape] },
          changes: [
            {
              kind: 'replace',
              id: shape,
              base: box.base,
              node: {
                ...box,
                paragraphs: [
                  {
                    ...first,
                    runs: [
                      visit,
                      { ...a, runs: [{ ...a.runs[0], text: 'Do' }] }
                    ]
                  },
                  { runs: [{ text: 'cs' }] }
                ]
              }
            }
          ]
        })
      );
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Do', 'rIdA'],
        ['cs', null]
      ]);
    });

    it('bolds part of a link, keeping both pieces in it', () => {
      const { deck, paragraph } = linkedDeck();
      expectCard(
        deck.write({
          intent: 'Bold cs.',
          scope: { ids: [paragraph] },
          changes: [
            {
              kind: 'set',
              target: {
                id: paragraph,
                shape: deck.read(paragraph).shape,
                match: { text: 'cs', span: { start: 8, end: 10 } }
              },
              props: { bold: true }
            }
          ]
        })
      );
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Do', 'rIdA'],
        ['cs', 'rIdA'],
        ['Help', 'rIdB']
      ]);
      expect(
        (deck.read(paragraph).runs as Node[])[1].runs.map((inner: Node) => [
          inner.text,
          inner.bold
        ])
      ).toEqual([
        ['Do', undefined],
        ['cs', true]
      ]);
    });

    it.each([
      [
        'two tooltips on one link',
        '<a:hlinkClick r:id="rIdA" tooltip="one"/>',
        '<a:hlinkClick r:id="rIdA" tooltip="two"/>'
      ],
      [
        'a hover-only link',
        '<a:hlinkMouseOver r:id="rIdA"/>',
        '<a:hlinkMouseOver r:id="rIdB"/>'
      ],
      [
        'a click action with no target',
        '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>',
        '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=lastslide"/>'
      ]
    ])('keeps %s on runs it leaves where they were', (_, docs, help) => {
      const { deck, paragraph, node } = linkedDeck(
        run('Visit ') + runWith('Docs', docs) + runWith('Help', help)
      );
      const [visit, ...rest] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [{ ...visit, text: 'See ' }, ...rest]
        })
      );
      expect(savedSlide(deck)).toContain(
        `<a:t>See </a:t></a:r>${runWith('Docs', docs)}${runWith('Help', help)}`
      );
    });

    describe.each([
      ['a hover action', '<a:hlinkMouseOver r:id="rIdA"/>', `on hover: ${A}`],
      [
        'a click action with no target',
        '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>',
        'ppaction://hlinkshowjump?jump=nextslide'
      ]
    ])('a run with %s', (_, action, target) => {
      const savedRun = (deck: ReturnType<typeof openDeck>, text: string) =>
        savedSlide(deck)
          .match(/<a:r>.*?<\/a:r>/g)!
          .find((xml) => xml.includes(`<a:t>${text}</a:t>`));

      it('reads as a link holding it', () => {
        const { node } = linkedDeck(
          run('Visit ') + runWith('Docs', action) + run('Help', 'rIdB')
        );
        expect(
          (node.runs as Node[]).map((child) =>
            child.kind === 'link'
              ? [child.target, child.runs.map((inner: Node) => inner.text)]
              : child.text
          )
        ).toEqual(['Visit ', [target, ['Docs']], [B, ['Help']]]);
      });

      it('keeps the action on both pieces when part of it is bolded', () => {
        const { deck, paragraph } = linkedDeck(
          run('Visit ') + runWith('Docs', action) + run('Help', 'rIdB')
        );
        expectCard(
          deck.write({
            intent: 'Bold cs.',
            scope: { ids: [paragraph] },
            changes: [
              {
                kind: 'set',
                target: {
                  id: paragraph,
                  shape: deck.read(paragraph).shape,
                  match: { text: 'cs', span: { start: 8, end: 10 } }
                },
                props: { bold: true }
              }
            ]
          })
        );
        expect(savedRun(deck, 'Do')).toContain(action);
        expect(savedRun(deck, 'cs')).toContain(action);
      });

      it('does not give the action to new text beside it', () => {
        const { deck, paragraph, node } = linkedDeck(
          run('Visit ') + runWith('Docs', action) + run('Help', 'rIdB')
        );
        const [visit, docs, help] = node.runs as Node[];
        expectCard(
          replaceParagraph(deck, paragraph, {
            ...node,
            runs: [visit, docs, { text: ' now' }, help]
          })
        );
        expect(savedRun(deck, 'Docs')).toContain(action);
        expect(savedRun(deck, ' now')).not.toContain(action);
      });
    });

    it.each([
      [
        'into',
        (visit: Node, a: Node, b: Node) => [
          { ...a, runs: [visit, ...a.runs] },
          b
        ],
        [
          ['Visit ', 'rIdA'],
          ['Docs', 'rIdA'],
          ['Help', 'rIdB']
        ]
      ],
      [
        'out of',
        (visit: Node, a: Node, b: Node) => [visit, ...a.runs, b],
        [
          ['Visit ', null],
          ['Docs', null],
          ['Help', 'rIdB']
        ]
      ]
    ])('moves existing text %s a link', (_, runs, saved) => {
      const { deck, paragraph, node } = linkedDeck();
      const [visit, a, b] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, { ...node, runs: runs(visit, a, b) })
      );
      expect(savedRuns(deck)).toEqual(saved);
    });

    it('removes the text between two links to one place', () => {
      const { deck, paragraph, node } = linkedDeck(
        run('Docs', 'rIdA') + run(' and ') + run('Help', 'rIdA'),
        'Docs and Help'
      );
      const [docs, , help] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, { ...node, runs: [docs, help] })
      );
      expect(savedRuns(deck)).toEqual([
        ['Docs', 'rIdA'],
        ['Help', 'rIdA']
      ]);
    });

    it('keeps a line break inside a link in it', () => {
      const { deck, paragraph, node } = linkedDeck();
      const [visit, a, b] = node.runs as Node[];
      expectCard(
        replaceParagraph(deck, paragraph, {
          ...node,
          runs: [
            visit,
            { ...a, runs: [...a.runs, { text: '\n' }, { text: 'more' }] },
            b
          ]
        })
      );
      expect(
        (deck.read(paragraph).runs as Node[]).map((child) =>
          child.kind === 'link'
            ? child.runs.map((inner: Node) => inner.text)
            : child.text
        )
      ).toEqual(['Visit ', ['Docs', '\n', 'more'], ['Help']]);
    });

    it('removes the slide a link is on and brings it back on reject', () => {
      const { deck } = linkedDeck();
      const slide = deck.find('Visit DocsHelp')[0].within[1];
      expectCard(
        deck.write({
          intent: 'Drop the title slide.',
          scope: { ids: [slide] },
          changes: [{ kind: 'delete', id: slide, base: deck.read(slide).base }]
        })
      );
      for (const record of deck.pending().reverse())
        expect(deck.engine.rejectChange(record.id).ok).toBe(true);
      expect(savedRuns(deck)).toEqual([
        ['Visit ', null],
        ['Docs', 'rIdA'],
        ['Help', 'rIdB']
      ]);
    });

    it('reports the formatting linked text takes from the layout', () => {
      const { deck, node } = linkedDeck();
      const [, a] = node.runs as Node[];
      const read = deck.call('read', {
        ids: [a.runs[0].id],
        properties: true
      }) as {
        nodes: Array<{
          properties: Record<string, { value: unknown; source: string }>;
        }>;
      };
      expect(read.nodes[0].properties.size).toEqual({
        value: 12,
        source: 'container'
      });
    });

    it.each([
      [
        'adding a link',
        (node: Node) => [
          ...node.runs,
          { kind: 'link', target: A, runs: [{ text: ' more' }] }
        ]
      ],
      [
        'changing where a link goes',
        (node: Node) =>
          node.runs.map((child: Node) =>
            child.kind === 'link'
              ? { ...child, target: 'https://c.example.com' }
              : child
          )
      ]
    ])('refuses %s', (_, runs) => {
      const { deck, paragraph, node } = linkedDeck();
      expect(
        replaceParagraph(deck, paragraph, { ...node, runs: runs(node) })
      ).toEqual(
        expect.objectContaining({
          ok: false,
          refusal: expect.objectContaining({ invariant: 'limits' })
        })
      );
    });
  });

  it('writes to a deck that was reopened', () => {
    const deck = openDeck();
    const host = createHost(deck.store, { readOnly: false });
    host.open(host.serialize());
    const { run } = subtitle(deck);
    expectCard(
      deck.write({
        intent: 'Rename the client.',
        scope: { ids: [run] },
        changes: [
          {
            kind: 'replace',
            id: run,
            base: deck.read(run).base,
            node: { ...deck.read(run), text: 'Acme' }
          }
        ]
      })
    );
  });

  it('a bulk set covers the formatting it spreads, not other edits inside what it matched', () => {
    const deck = openDeck();
    const { run, shape } = subtitle(deck);
    const find = { kind: 'paragraph', within: shape };
    const found = deck.call('find', find) as { total: number; shape: string };
    const bulk = {
      kind: 'set',
      target: { find, total: found.total, shape: found.shape },
      props: { size: 20 }
    };
    const result = deck.write({
      intent: 'Bigger, and rename the client.',
      scope: { ids: [], bulk: [{ find, total: found.total }] },
      changes: [
        bulk,
        {
          kind: 'replace',
          id: run,
          base: deck.read(run).base,
          node: { ...deck.read(run), text: 'Acme' }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'scope' })
      })
    );
  });

  it('a bulk set covers only the values it sets on what it spreads to', () => {
    const deck = openDeck();
    const { run, shape } = subtitle(deck);
    const find = { kind: 'paragraph', within: shape };
    const found = deck.call('find', find) as { total: number; shape: string };
    const result = deck.write({
      intent: 'Bigger, one run much bigger.',
      scope: { ids: [], bulk: [{ find, total: found.total }] },
      changes: [
        {
          kind: 'set',
          target: { find, total: found.total, shape: found.shape },
          props: { size: 20 }
        },
        {
          kind: 'replace',
          id: run,
          base: deck.read(run).base,
          node: { ...deck.read(run), size: 99 }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'scope' })
      })
    );
  });

  it('refuses text holding a control character a deck cannot hold', () => {
    const deck = openDeck();
    const { run } = subtitle(deck);
    const result = deck.write({
      intent: 'Rename the client.',
      scope: { ids: [run] },
      changes: [
        {
          kind: 'replace',
          id: run,
          base: deck.read(run).base,
          node: { ...deck.read(run), text: 'Acme\u000bCorp' }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });

  it('refuses a size the deck cannot hold and a colour not in capitals', () => {
    const deck = openDeck();
    const { run, paragraph } = subtitle(deck);
    const refusedBy = (result: WriteResult) =>
      (result as { refusal?: { invariant: string } }).refusal?.invariant;
    expect(
      refusedBy(
        deck.write({
          intent: 'Shrink the subtitle.',
          scope: { ids: [run] },
          changes: [
            {
              kind: 'replace',
              id: run,
              base: deck.read(run).base,
              node: { ...deck.read(run), size: 0 }
            }
          ]
        })
      )
    ).toBe('limits');
    expect(
      refusedBy(
        deck.write({
          intent: 'Colour the subtitle.',
          scope: { ids: [paragraph] },
          changes: [
            {
              kind: 'set',
              target: { ids: [run], shape: { [run]: deck.read(run).shape } },
              props: { color: '#ff00aa' }
            }
          ]
        })
      )
    ).toBe('property-invalid');
    expect(deck.pending()).toHaveLength(0);
  });
});

describe('PowerPoint slide number fields', () => {
  const footer = (deck: ReturnType<typeof openDeck>) => {
    const paragraph = deck.find('‹#›')[0].id;
    return { paragraph, node: deck.read(paragraph) };
  };
  const runsOf = (node: Record<string, unknown>) =>
    node.runs as Array<Record<string, unknown>>;

  it('bolds a line holding a slide number, leaving the number as the deck has it', () => {
    const deck = openDeck();
    const { paragraph } = footer(deck);
    expectCard(
      deck.write({
        intent: 'Bold the footer.',
        scope: { ids: [paragraph] },
        changes: [
          {
            kind: 'set',
            target: {
              ids: [paragraph],
              shape: { [paragraph]: deck.read(paragraph).shape }
            },
            props: { bold: true }
          }
        ]
      })
    );
    const runs = runsOf(deck.read(paragraph));
    expect(
      runs.filter((run) => run.kind === 'run').every((run) => run.bold)
    ).toBe(true);
    expect(runs.find((run) => run.kind === 'field')?.bold).toBeUndefined();
  });

  it('adds text after a slide number as plain text', () => {
    const deck = openDeck();
    const { paragraph, node } = footer(deck);
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...node,
        runs: [...runsOf(node), { text: ' Confidential' }]
      })
    );
    const runs = runsOf(deck.read(paragraph));
    expect(runs.map((run) => run.kind).slice(-2)).toEqual(['field', 'run']);
    expect(runs.filter((run) => run.kind === 'field')).toHaveLength(1);
  });

  it('adds plain text after a slide number that is the only text in its box', () => {
    const deck = openDeck('powerpoint-text-defaults.pptx');
    const { paragraph, node } = footer(deck);
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...node,
        runs: [...runsOf(node), { text: ' Confidential' }]
      })
    );
    expect(runsOf(deck.read(paragraph)).map((run) => run.kind)).toEqual([
      'field',
      'run'
    ]);
  });

  it('refuses formatting the slide number itself before trying it', () => {
    const deck = openDeck();
    const { paragraph, node } = footer(deck);
    const result = replaceParagraph(deck, paragraph, {
      ...node,
      runs: runsOf(node).map((run) =>
        run.kind === 'field' ? { ...run, bold: true } : run
      )
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });
});
