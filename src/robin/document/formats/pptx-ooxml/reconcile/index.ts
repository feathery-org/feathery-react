import type { CommitPlan, DocumentView, PlanContext } from '../../../pack';
import {
  canonicalJson,
  hasPendingInside,
  walk,
  withoutLists,
  type NfNode
} from '../../../tree';
import type { Pending } from '../adapter/toNormalForm';
import type { DeckOperation, ShapeRef, SlideRef } from '../seams/deck';
import { PARAGRAPH_FORMAT, RUN_FORMAT } from '../textSources';
import { isShapeKind, pptxTree } from '../tree';
import { textOperations } from './text';

/** A difference the editor cannot build, with what to do instead */
export interface Cannot {
  id: string;
  why: string;
}

export interface DeckPlan {
  operations: DeckOperation[];
  cannot: Cannot[];
}

type Frame = { x: number; y: number; cx: number; cy: number };

const pendingOf = (node: NfNode | undefined) =>
  node?.pending as Pending | undefined;
const isLive = (node: NfNode) => !pendingOf(node)?.deletion;
const liveShapes = (slide: NfNode) => (slide.shapes as NfNode[]).filter(isLive);
const listOf = (node: NfNode, key: string) =>
  (node[key] as NfNode[] | undefined) ?? [];

const COPY_SLIDE =
  'copy an existing slide by writing it as read, with its ids, then change what it holds';
export const FRAME = '{x, y, cx, cy}: whole EMU, cx and cy at least 1';
const NEW_FIELD =
  'is a new field: the deck adds fields, keep one by writing it and its paragraph with the ids they were read with';

// What the editor writes on each kind of node: every other value is the deck's
const WRITABLE: Record<string, readonly string[]> = {
  slide: [],
  paragraph: PARAGRAPH_FORMAT,
  run: ['text', ...RUN_FORMAT],
  break: ['text'],
  field: []
};

function ownValues(node: NfNode): Record<string, unknown> {
  const own = withoutLists(node, pptxTree);
  for (const key of ['id', 'pending', 'inherited', 'path']) delete own[key];
  return own;
}

/** The values a write changes on a node that the editor cannot write on its kind */
function unwritable(old: NfNode | undefined, node: NfNode): string[] {
  const writable =
    WRITABLE[node.kind] ?? (isShapeKind(node.kind) ? ['frame'] : []);
  const was = old ? ownValues(old) : { kind: node.kind };
  const now = ownValues(node);
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (key) =>
      !writable.includes(key) &&
      canonicalJson(was[key]) !== canonicalJson(now[key])
  );
}

/** What a reader sees of a subtree, ids and what the deck derives aside */
function content(node: NfNode): { own: unknown; children: unknown[] } {
  const own = withoutLists(node, pptxTree);
  for (const key of ['id', 'pending', 'inherited', 'path']) delete own[key];
  const children = pptxTree
    .childLists(node)
    .map((list) => listOf(node, list).map(content));
  return { own, children };
}

/** A child list a write adds to or drops from a node, which the editor cannot do */
function listChange(old: NfNode, node: NfNode): string | null {
  const was = pptxTree.childLists(old);
  const now = pptxTree.childLists(node);
  const dropped = was.filter((list) => !now.includes(list));
  const gained = now.filter((list) => !was.includes(list));
  if (gained.includes('paragraphs'))
    return 'has no text yet: the editor can only write text into a shape that already holds some, tell the person to add it by hand';
  if (dropped.length)
    return `drops its ${dropped.join(
      ', '
    )}: write them as read, changed as needed`;
  if (gained.length)
    return `adds ${gained.join(', ')}, which the editor cannot`;
  return null;
}

// The editor gives a frame no width or height below 1, so a line cannot keep its own
const isLine = (node: NfNode) => {
  const frame = node.frame as Frame | undefined;
  return !!frame && (frame.cx === 0 || frame.cy === 0);
};
// The editor rescales a table's columns and rows with its frame
const resized = (old: NfNode, node: NfNode) => {
  const [was, now] = [old.frame, node.frame] as Frame[];
  return was.cx !== now.cx || was.cy !== now.cy;
};

const sameContent = (a: NfNode, b: NfNode) =>
  canonicalJson(content(a)) === canonicalJson(content(b));

function clearedFormat(before: NfNode, after: NfNode): string | null {
  const cleared = [...RUN_FORMAT, ...PARAGRAPH_FORMAT, 'frame'].filter(
    (key) => before[key] !== undefined && after[key] === undefined
  );
  return cleared.length ? cleared.join(', ') : null;
}

/** Every difference as the editor's operations, or as a reason when the editor cannot build it */
export function planDeck(
  before: DocumentView,
  intended: DocumentView,
  copies: Readonly<Record<string, string>> = {}
): DeckPlan {
  const operations: DeckOperation[] = [];
  const cannot: Cannot[] = [];
  const refuse = (id: string, why: string) => cannot.push({ id, why });
  const originOf = (id: string) => copies[id] ?? id;
  const isCopy = (id: string) => id in copies;

  // A suggested removal stays as it is until the person accepts or rejects it
  walk(before.nf.root, pptxTree, ({ node }) => {
    if (!pendingOf(node)?.deletion) return;
    const now = intended.get(node.id);
    if (!now || !sameContent(node, now))
      refuse(node.id, 'is a suggested removal: accept or reject it first');
    return false;
  });

  /** Text a shape is written with: new text and its own edits, never what the deck keeps */
  function checkText(old: NfNode | undefined, shape: NfNode): void {
    const own = new Set<string>();
    for (const paragraph of old ? listOf(old, 'paragraphs') : []) {
      own.add(paragraph.id);
      for (const run of listOf(paragraph, 'runs')) own.add(run.id);
    }
    for (const paragraph of listOf(shape, 'paragraphs'))
      for (const node of [paragraph, ...listOf(paragraph, 'runs')]) {
        const origin = before.get(originOf(node.id));
        if (origin && !own.has(origin.id)) {
          refuse(
            node.id,
            'moves to another container, which the editor cannot do'
          );
          continue;
        }
        if (node.kind === 'field' && (!origin || !sameContent(origin, node))) {
          refuse(
            node.id,
            origin
              ? 'is a field, which the deck fills in and keeps as it is: change the text around it'
              : NEW_FIELD
          );
          continue;
        }
        if (node.kind === 'break' && node.text !== '\n')
          refuse(node.id, 'is a break, written as { "text": "\\n" }');
        const lists = origin && listChange(origin, node);
        if (lists) refuse(node.id, lists);
        const keys = unwritable(origin, node);
        if (keys.length)
          refuse(
            node.id,
            `writes ${keys.join(', ')} on a ${
              node.kind
            }, which the editor does not: give it only text and its own formatting`
          );
        const cleared = origin && clearedFormat(origin, node);
        if (cleared)
          refuse(
            node.id,
            `clears ${cleared}: give the value it should have instead`
          );
      }
  }

  function textChanges(
    slide: SlideRef,
    shapeRef: ShapeRef,
    old: NfNode,
    shape: NfNode
  ): void {
    if (!Array.isArray(old.paragraphs) || !Array.isArray(shape.paragraphs))
      return;
    checkText(old, shape);
    operations.push(...textOperations(slide, shapeRef, old, shape, originOf));
  }

  function shapeChanges(
    slide: SlideRef,
    old: NfNode,
    shape: NfNode,
    inGroup: boolean
  ): Frame | null {
    const keys = unwritable(old, shape);
    if (keys.length)
      refuse(
        shape.id,
        `changes ${keys.join(', ')} on a ${
          shape.kind
        }, which the editor keeps as it is`
      );
    const lists = listChange(old, shape);
    if (lists) {
      refuse(shape.id, lists);
      return null;
    }
    let frame: Frame | null = null;
    if (canonicalJson(old.frame) !== canonicalJson(shape.frame)) {
      if (inGroup)
        refuse(
          shape.id,
          'is inside a group, whose frame cannot be changed on its own'
        );
      else if (shape.frame === undefined)
        refuse(shape.id, 'clears frame: give the value it should have instead');
      else if (isLine(old))
        refuse(
          shape.id,
          "is a line, which can't be moved or resized yet: tell the person to do it by hand"
        );
      else if (shape.kind === 'table' && resized(old, shape))
        refuse(
          shape.id,
          'is a table, which can be moved but not resized yet: tell the person to resize it by hand'
        );
      else frame = shape.frame as Frame;
    }
    if (shape.kind === 'table') {
      // Its frame is a move, its rows are the content
      if (
        canonicalJson(content(old).children) !==
        canonicalJson(content(shape).children)
      )
        refuse(
          shape.id,
          "is a table, whose content can't be changed yet: tell the person to edit the table by hand"
        );
      return frame;
    }
    if (shape.kind === 'group') {
      const members = (group: NfNode) =>
        canonicalJson(listOf(group, 'shapes').map((m) => originOf(m.id)));
      if (members(old) !== members(shape)) {
        refuse(
          shape.id,
          'is a group, whose members cannot be added or removed'
        );
        return frame;
      }
      listOf(shape, 'shapes').forEach((member, i) =>
        shapeChanges(slide, listOf(old, 'shapes')[i], member, true)
      );
      return frame;
    }
    textChanges(slide, String(shape.shapeId), old, shape);
    return frame;
  }

  function newShape(slide: SlideRef, shape: NfNode, ref: string): void {
    const elsewhere = before.get(originOf(shape.id));
    if (elsewhere) {
      refuse(
        shape.id,
        isCopy(shape.id)
          ? 'copies a shape, which is only possible by copying its whole slide'
          : 'moves to another container, which the editor cannot do'
      );
      return;
    }
    if (shape.shapeId !== undefined) {
      refuse(
        shape.id,
        `has a shapeId but not the id it was read with: ${COPY_SLIDE}`
      );
      return;
    }
    if (shape.kind !== 'shape' || !Array.isArray(shape.paragraphs)) {
      refuse(
        shape.id,
        `is a new ${shape.kind}: only a text box (a shape with paragraphs) can be added`
      );
      return;
    }
    const extra = unwritable(undefined, shape);
    if (extra.length)
      refuse(
        shape.id,
        `is a new text box with ${extra.join(
          ', '
        )}: write it with kind, frame and paragraphs only`
      );
    checkText(undefined, shape);
    if (!shape.frame) {
      refuse(
        shape.id,
        `is a new text box without a frame: give it frame ${FRAME}`
      );
      return;
    }
    operations.push(
      {
        command: {
          type: 'insert-shape',
          onSlide: slide,
          shape: { kind: 'text-box', ...(shape.frame as Frame) }
        },
        creates: { shape: ref }
      },
      ...textOperations(
        slide,
        { ref },
        { id: '', kind: 'shape', paragraphs: [TEXT_BOX_START] },
        shape
      )
    );
  }

  function shapeOperations(
    slide: SlideRef,
    oldShapes: NfNode[],
    shapes: NfNode[]
  ): void {
    const pairs = shapes.flatMap((shape) => {
      const old = oldShapes.find((c) => c.id === originOf(shape.id));
      return old ? [{ old, shape }] : [];
    });
    const kept = new Set(pairs.map(({ old }) => old));
    const removed = oldShapes.filter((shape) => !kept.has(shape));
    if (removed.length)
      operations.push({
        command: {
          type: 'delete-shapes',
          onSlide: slide,
          shapeIds: removed.map((shape) => String(shape.shapeId))
        }
      });

    // Shapes keep their stacking order, which is their order in the list
    const order = oldShapes.filter((shape) => kept.has(shape));
    const moved = pairs.find(({ old }, i) => order[i] !== old);
    if (moved)
      refuse(
        moved.shape.id,
        'changes the stacking order of shapes, which is not supported'
      );

    const geometry = pairs.flatMap(({ old, shape }) => {
      const frame = shapeChanges(slide, old, shape, false);
      return frame ? [{ shapeId: String(shape.shapeId), geometry: frame }] : [];
    });
    if (geometry.length)
      operations.push({
        command: {
          type: 'set-shape-geometries',
          onSlide: slide,
          updates: geometry
        }
      });

    const paired = new Set(pairs.map(({ shape }) => shape));
    const added = shapes.filter((shape) => !paired.has(shape));
    added.forEach((shape, i) =>
      newShape(
        slide,
        shape,
        `${typeof slide === 'string' ? slide : slide.ref}:box${i}`
      )
    );
    const onTop = shapes.slice(shapes.length - added.length);
    const under = added.find((shape) => !onTop.includes(shape));
    if (under)
      refuse(
        under.id,
        'is a new text box below other shapes: a new text box goes on top, after every other shape of its slide'
      );
  }

  const beforeSlides = (before.nf.root.slides as NfNode[]).filter(isLive);
  const afterSlides = (intended.nf.root.slides as NfNode[]).filter(isLive);
  const keyOf = new Map<NfNode, string>();
  const order = beforeSlides.map((slide) => String(slide.path));

  // New slides are copies, taken before anything is changed on the slides they copy
  const added = afterSlides.filter((slide) => !before.get(slide.id));
  for (const slide of added) {
    const source = isCopy(slide.id)
      ? before.get(originOf(slide.id))
      : undefined;
    if (source?.kind !== 'slide' || !isLive(source)) {
      refuse(slide.id, `is a new slide: ${COPY_SLIDE}`);
      continue;
    }
    if (source.pending || hasPendingInside(source, pptxTree)) {
      refuse(
        slide.id,
        'copies a slide with suggestions still pending: accept or reject them first'
      );
      continue;
    }
    const keys = unwritable(source, slide);
    if (keys.length) {
      refuse(
        slide.id,
        `changes ${keys.join(', ')} on a slide, which the editor keeps as it is`
      );
      continue;
    }
    const ref = `slide:${slide.id}`;
    keyOf.set(slide, ref);
    order.push(ref);
    operations.push({
      command: {
        type: 'add-slide',
        atIndex: beforeSlides.length + added.indexOf(slide),
        copyOf: String(source.path)
      },
      creates: { slide: ref }
    });
    shapeOperations({ ref }, liveShapes(source), liveShapes(slide));
  }

  for (const slide of afterSlides) {
    const old = before.get(slide.id);
    if (!old) continue;
    keyOf.set(slide, String(slide.path));
    const keys = [
      ...unwritable(old, slide),
      ...(old.path === slide.path ? [] : ['path'])
    ];
    if (keys.length)
      refuse(
        slide.id,
        `changes ${keys.join(', ')} on a slide, which the editor keeps as it is`
      );
    shapeOperations(String(slide.path), liveShapes(old), liveShapes(slide));
  }

  for (const slide of beforeSlides) {
    if (intended.get(slide.id)) continue;
    order.splice(order.indexOf(String(slide.path)), 1);
    operations.push({
      command: { type: 'delete-slide', onSlide: String(slide.path) }
    });
  }
  const target = afterSlides.flatMap((slide) => keyOf.get(slide) ?? []);
  operations.push(...moves(order, target));
  return { operations, cannot };
}

// What a new text box holds before its text is written: one run of the editor's own text
const TEXT_BOX_START: NfNode = {
  id: '',
  kind: 'paragraph',
  runs: [{ id: '', kind: 'run', text: 'Text', size: 18 }]
};

function moves(current: string[], target: string[]): DeckOperation[] {
  const operations: DeckOperation[] = [];
  const order = [...current];
  target.forEach((key, toIndex) => {
    const fromIndex = order.indexOf(key);
    if (fromIndex === toIndex) return;
    order.splice(fromIndex, 1);
    order.splice(toIndex, 0, key);
    operations.push({ command: { type: 'move-slide', fromIndex, toIndex } });
  });
  return operations;
}

export function plan(ctx: PlanContext): CommitPlan {
  const { operations, cannot } = planDeck(ctx.before, ctx.intended, ctx.copies);
  // The limits invariant refuses these before a write gets here
  if (cannot.length) throw new Error(`${cannot[0].id} ${cannot[0].why}`);
  return {
    steps: [{ seam: 'deck', payload: operations }],
    landed: 'card',
    history: 'editor'
  };
}
