/**
 * The splice seam: the engine's composed tracked document replaces the editor's (WP1 P3, the only
 * path that passes for table structure). The editor's undo history is cleared by the open; the
 * engine's history keeps the way back.
 */
import type { Seam } from '../../../pack';

export const spliceSeam: Seam = {
  apply(host, payload) {
    host.open(String(payload));
  }
};
