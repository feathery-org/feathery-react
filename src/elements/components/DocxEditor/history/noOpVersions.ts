import { DocxVersion } from './types';

// A closed session whose final content matches the version before it changed
// nothing on balance (its edits were undone). It stays stored, just unlisted.
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
