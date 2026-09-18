import { DocumentPersistenceError } from '../../../../utils/documentPersistence';
import type { DocxVersion } from './types';
import type { ChangeList } from './sfdtDiff/types';

const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const invalid = () =>
  new DocumentPersistenceError('Invalid version-history response', 'invalid');

export function parseDocxVersion(value: unknown): DocxVersion {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    !count(value.seq) ||
    typeof value.is_current !== 'boolean' ||
    typeof value.is_baseline !== 'boolean' ||
    !Array.isArray(value.authors) ||
    !value.authors.every(
      (author: unknown) =>
        object(author) &&
        ['user', 'assistant'].includes(author.kind) &&
        typeof author.label === 'string' &&
        (author.key == null || typeof author.key === 'string')
    )
  )
    throw invalid();
  for (const key of [
    'session_id',
    'name',
    'started_at',
    'ended_at',
    'closed_at',
    'actor_label',
    'actor_name',
    'restored_from',
    'restored_from_at',
    'editor_file',
    'file',
    'final_sfdt',
    'changes',
    'final_sha256',
    'highlights_pruned_at',
    'created_at'
  ])
    if (value[key] != null && typeof value[key] !== 'string') throw invalid();
  for (const key of ['change_count', 'format_change_count'])
    if (value[key] != null && !count(value[key])) throw invalid();
  return {
    session_id: null,
    name: '',
    started_at: '',
    ended_at: '',
    closed_at: null,
    actor_label: '',
    actor_name: '',
    restored_from: null,
    restored_from_at: null,
    editor_file: null,
    file: null,
    final_sfdt: null,
    changes: null,
    change_count: null,
    format_change_count: null,
    final_sha256: '',
    highlights_pruned_at: null,
    created_at: '',
    ...value
  } as DocxVersion;
}

export function parseEnvelopeDocument(value: unknown): Record<string, any> {
  if (!object(value)) throw invalid();
  for (const key of ['id', 'file', 'editor_file'])
    if (value[key] != null && typeof value[key] !== 'string') throw invalid();
  return {
    ...value,
    ...(value.version != null
      ? { version: parseDocxVersion(value.version) }
      : {})
  };
}

export function parseVersionList(value: unknown): DocxVersion[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(parseDocxVersion);
}

export function parseChangeList(value: unknown): ChangeList {
  if (
    !object(value) ||
    value.v !== 1 ||
    typeof value.sessionId !== 'string' ||
    typeof value.final_sha256 !== 'string' ||
    !Array.isArray(value.hunks) ||
    !count(value.changeCount) ||
    !count(value.formatChangeCount) ||
    !Array.isArray(value.authors) ||
    !value.authors.every((author: unknown) => typeof author === 'string')
  )
    throw invalid();
  if (
    (value.confirmed != null && typeof value.confirmed !== 'boolean') ||
    (value.attribution != null && value.attribution !== 'slices')
  )
    throw invalid();
  const types = ['ins', 'del', 'fmt', 'ins_block', 'del_block', 'fmt_block'];
  for (const hunk of value.hunks) {
    if (
      !object(hunk) ||
      !count(hunk.id) ||
      typeof hunk.author !== 'string' ||
      !types.includes(hunk.type) ||
      !object(hunk.at) ||
      !Array.isArray(hunk.at.block) ||
      hunk.at.block.length < 3 ||
      !count(hunk.at.block[0]) ||
      !hunk.at.block.every((part: unknown) =>
        typeof part === 'number'
          ? count(part)
          : typeof part === 'string' &&
            !['__proto__', 'prototype', 'constructor'].includes(part)
      )
    )
      throw invalid();
    if (['ins', 'del', 'fmt'].includes(hunk.type) && !count(hunk.at.offset))
      throw invalid();
    if (['ins', 'fmt'].includes(hunk.type) && !count(hunk.at.length))
      throw invalid();
    if (hunk.type === 'del' && typeof hunk.text !== 'string') throw invalid();
    if (hunk.type === 'del_block' && !Array.isArray(hunk.blocks))
      throw invalid();
    if (hunk.type === 'ins_block' && !count(hunk.count)) throw invalid();
    if (
      hunk.type.startsWith('fmt') &&
      (!object(hunk.props) ||
        !Object.entries(hunk.props).every(
          ([key, delta]) =>
            !['__proto__', 'prototype', 'constructor'].includes(key) &&
            Array.isArray(delta) &&
            delta.length === 2
        ))
    )
      throw invalid();
  }
  for (const key of ['trackedAuthors', 'degraded'])
    if (
      value[key] != null &&
      (!Array.isArray(value[key]) ||
        !value[key].every((entry: unknown) => typeof entry === 'string'))
    )
      throw invalid();
  if (
    value.robinRuns != null &&
    (!Array.isArray(value.robinRuns) ||
      !value.robinRuns.every(
        (run: unknown) =>
          object(run) &&
          ['ins', 'del'].includes(run.kind) &&
          typeof run.text === 'string' &&
          (run.group == null || typeof run.group === 'string')
      ))
  )
    throw invalid();
  return value as ChangeList;
}
