/**
 * Derive a display/download filename from a file URL.
 *
 * S3 URLs percent-encode the object key, so the last path segment has to be
 * decoded before a user sees it. decodeURIComponent (not decodeURI) is required
 * or reserved characters such as %26 survive into the name, and a malformed
 * escape has to fall back to the raw segment rather than throw URIError.
 */
export function getFilenameFromUrl(fileUrl: string): string {
  // Strip URL metadata before decoding: escaped ? and # belong to the name.
  const path = fileUrl.split(/[?#]/, 1)[0];
  const filename = path.substring(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}
