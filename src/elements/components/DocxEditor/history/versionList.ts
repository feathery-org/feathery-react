import type { DocxHistoryHost, DocxVersion } from './types';

// The rail and background preparation share the same refresh generation.
const lists = new WeakMap<
  DocxHistoryHost,
  { key: string; rows: Promise<DocxVersion[]> }
>();
export function loadVersionList(
  host: DocxHistoryHost,
  refreshKey: number | string = '',
  retry = false
): Promise<DocxVersion[]> {
  const key = String(refreshKey);
  const cached = lists.get(host);
  if (!retry && cached?.key === key) return cached.rows;
  const rows = host.listVersions().catch((error) => {
    if (lists.get(host)?.rows === rows) lists.delete(host);
    throw error;
  });
  lists.set(host, { key, rows });
  return rows;
}
