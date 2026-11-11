import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createPptxEditorStore } from '../../../../../elements/components/PptxEditor/state/PptxEditorStore';
import type { ReadResult, Verb, VerbResult } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { createHost, pptxPack } from '../index';

export const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      resolve(
        __dirname,
        '../../../../../elements/components/PptxEditor/tests/fixtures',
        name
      )
    )
  );

const target = { type: 'envelope', id: 'env_1' };

export type WriteResult = Extract<VerbResult, { committed: boolean }>;

/** A headless editor with a deck open and Robin's session over it */
export function openDeck(name = 'marketing-parity.pptx', bytes = fixture(name)) {
  const store = createPptxEditorStore();
  store.loadFile(bytes, name);
  const session = new DocumentSession({
    pack: pptxPack,
    host: createHost(store, { readOnly: false }),
    target,
    editorId: 'ed-1'
  });
  const call = (verb: Verb, input: unknown, turnId = 'turn-1'): VerbResult => {
    const out = session.dispatch(verb, {
      turnId,
      editorId: 'ed-1',
      target,
      input
    });
    if (out.status !== 'ok')
      throw new Error(`dispatch failed: ${JSON.stringify(out)}`);
    return out.result;
  };
  const read = (id: string, turnId = 'turn-1') =>
    (call('read', { ids: [id] }, turnId) as ReadResult).nodes.find(
      (node) => node.id === id
    ) as ReadResult['nodes'][number] & Record<string, unknown>;
  const find = (text: string, turnId = 'turn-1') =>
    (call('find', { text }, turnId) as { hits: Array<{ id: string; within: string[] }> })
      .hits;
  const write = (input: unknown, turnId = 'turn-1') =>
    call('write', input, turnId) as WriteResult;
  const pending = () =>
    store.engine.changes().filter((record) => record.status === 'pending');
  return { store, engine: store.engine, session, call, read, find, write, pending };
}
