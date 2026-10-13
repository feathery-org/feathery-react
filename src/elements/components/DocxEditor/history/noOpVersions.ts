import { DocxVersion } from './types';

// A closed session that recorded no changes and ends where the version before
// it did was undone; accepting tracked changes keeps its count, so it stays.
export function hideNoOpVersions(versions: DocxVersion[]): DocxVersion[] {
  const bySeq = [...versions].sort((a, b) => b.seq - a.seq);
  const hidden = new Set<string>();
  bySeq.forEach((version, index) => {
    const prior = bySeq[index + 1];
    if (
      prior &&
      version.final_sha256 &&
      version.final_sha256 === prior.final_sha256 &&
      version.closed_at &&
      !version.change_count &&
      !version.format_change_count &&
      !version.is_current &&
      !version.is_baseline &&
      !version.name &&
      !version.restored_from &&
      !version.restored_from_at
    )
      hidden.add(version.id);
  });
  return versions.filter((version) => !hidden.has(version.id));
}
