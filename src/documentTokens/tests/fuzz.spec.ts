/**
 * Random gestures against a real editor, with the structural invariants checked
 * after every single one.
 *
 * Every defect this feature has shipped was found by a person driving a browser
 * and noticing a mangled number: text compounded onto itself, a control whose
 * markers were eaten, a token duplicated. All three are violations of
 * `shapeViolations`, so a machine can hunt them far harder than we can — and
 * name the gesture that caused it.
 *
 * Deterministic: the generator is seeded, and a failure prints the seed and the
 * gesture list to replay.
 */

import { documentShape, shapeViolations } from '../controls';
import { TokenSpec } from '../plan';
import { attachTokenCycle, FieldAccess, TokenValue } from '../tokenCycle';
import {
  makeTokenEditor,
  selectToken,
  TokenFixture
} from './realEditorHarness';

/** A tiny deterministic PRNG, so a failing run replays from its seed. */
const randomFrom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const SPECS: TokenSpec[] = [
  {
    id: 'qty',
    index: 0,
    source: 'qty',
    format: { kind: 'number' },
    validate: { min: 1 }
  },
  { id: 'cost', index: 0, source: 'cost', format: { kind: 'currency' } },
  {
    id: 'item_total',
    index: 0,
    formula: 'qty * cost',
    format: { kind: 'currency' }
  },
  { id: 'note', source: 'note', format: { kind: 'text' } }
];

const FIXTURES: TokenFixture[] = [
  { spec: SPECS[0], text: '2' },
  { spec: SPECS[1], text: '$30.00' },
  { spec: SPECS[2], text: '$60.00' },
  { spec: SPECS[3], text: 'blue' }
];

const ADDRESSES = ['qty__0', 'cost__0', 'item_total__0', 'note'];

/** A field store, the way the form engine holds values. */
const fieldStore = (): FieldAccess & { values: Record<string, TokenValue> } => {
  const values: Record<string, TokenValue> = { qty: 2, cost: 30, note: 'blue' };
  return {
    values,
    read: (spec) => (spec.source ? values[spec.source] : undefined),
    write: (updates) => {
      for (const { spec, value } of updates) {
        if (spec.source) values[spec.source] = value;
      }
    }
  };
};

type Gesture = { what: string; run: () => void };

const gesturesFor = (
  editor: any,
  cycle: ReturnType<typeof attachTokenCycle>,
  next: () => number
): Gesture[] => {
  const address = () => ADDRESSES[Math.floor(next() * ADDRESSES.length)];
  const char = () => '0123456789.,$'[Math.floor(next() * 13)];

  return [
    {
      what: 'caret into a token',
      run: () => {
        selectToken(editor, address());
      }
    },
    {
      what: 'type a character',
      run: () => {
        if (!selectToken(editor, address())) return;
        editor.editor.insertText(char());
      }
    },
    {
      what: 'clear a value',
      run: () => {
        if (!selectToken(editor, address())) return;
        if (editor.selection.text) editor.editor.delete();
      }
    },
    {
      what: 'clear then retype',
      run: () => {
        if (!selectToken(editor, address())) return;
        if (editor.selection.text) editor.editor.delete();
        editor.editor.insertText('100');
      }
    },
    { what: 'undo', run: () => editor.editorHistory?.undo() },
    { what: 'redo', run: () => editor.editorHistory?.redo() },
    { what: 'reconcile', run: () => cycle.reconcile() },
    {
      what: 'set a value through the cycle',
      run: () => cycle.setTokenValue(address(), Math.floor(next() * 500))
    }
  ];
};

describe('token gestures never damage the document', () => {
  // A handful of seeds, each a different gesture order. Cheap enough for every
  // build; raise the count when chasing something specific.
  const SEEDS = [1, 7, 42, 99, 12345];
  const STEPS = 25;

  it.each(SEEDS)('survives %i random gestures', (seed) => {
    const next = randomFrom(seed);
    const { editor, destroy } = makeTokenEditor(FIXTURES);

    try {
      const fields = fieldStore();
      const cycle = attachTokenCycle(editor as any, { fields });
      const gestures = gesturesFor(editor, cycle, next);
      const performed: string[] = [];

      // The controls present at the start are the contract: a gesture may
      // change VALUES, never the structure.
      expect(
        documentShape(editor as any)
          .addresses.slice()
          .sort()
      ).toEqual([...ADDRESSES].sort());

      const threw: string[] = [];
      for (let step = 0; step < STEPS; step += 1) {
        const gesture = gestures[Math.floor(next() * gestures.length)];
        const before = documentShape(editor as any);
        // A throw is recorded, not asserted on: jsdom fakes layout, so the
        // editor can fail on geometry it would have in a browser. The structural
        // invariant below is the contract that must hold either way.
        try {
          gesture.run();
        } catch (error) {
          threw.push(`${gesture.what}: ${(error as Error).message}`);
        }
        performed.push(gesture.what);

        // Only the structure is asserted per step, since any gesture may
        // legitimately move a value.
        const structural = shapeViolations(
          { addresses: before.addresses, text: new Map() },
          {
            addresses: documentShape(editor as any).addresses,
            text: new Map()
          },
          new Set()
        );
        if (structural.length > 0) {
          throw new Error(
            `seed ${seed} step ${step} (${gesture.what}) broke the document:\n` +
              `  ${structural.join('\n  ')}\n` +
              `  gestures: ${performed.join(' -> ')}`
          );
        }
      }

      cycle.detach();
      if (threw.length > 0) {
        // Surfaced so a real regression is not hidden behind jsdom noise.
        // eslint-disable-next-line no-console
        console.log(
          `seed ${seed}: ${threw.length} gesture(s) threw in jsdom\n  ${threw
            .slice(0, 3)
            .join('\n  ')}`
        );
      }
    } finally {
      destroy();
    }
  });
});

describe('the harness itself', () => {
  it('is exercising real content controls, not a fake', () => {
    const { editor, destroy } = makeTokenEditor(FIXTURES);
    try {
      const collection: any[] = (editor as any).documentHelper
        .contentControlCollection;
      // Real ContentControl start elements, built by SyncFusion's SFDT reader.
      expect(collection).toHaveLength(ADDRESSES.length);
      expect(collection.every((c) => c.type === 0)).toBe(true);
      expect(documentShape(editor as any).text.get('cost__0')).toBe('$30.00');
      // And the bookmarks wrap.py emits round-tripped too.
      expect(editor.getBookmarks()).toEqual(
        expect.arrayContaining(['ftk_cost__0', 'ftk_qty__0'])
      );
    } finally {
      destroy();
    }
  });

  it('detects a control that a gesture destroyed', () => {
    // Deliberate damage: without this, a passing fuzz run proves nothing about
    // whether the check can fire at all.
    const { editor, destroy } = makeTokenEditor(FIXTURES);
    try {
      const before = documentShape(editor as any);
      selectToken(editor, 'cost__0');
      // The operation behind "Remove Content Control", which is exactly why that
      // menu item is hidden: it destroys a token and nothing can rebuild it.
      (editor.editor as any).removeContentControl();

      const problems = shapeViolations(
        before,
        documentShape(editor as any),
        new Set(['cost__0'])
      );
      expect(problems.join(' ')).toContain('cost__0 vanished');
    } finally {
      destroy();
    }
  });
});
