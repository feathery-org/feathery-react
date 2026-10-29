import type { Deck } from '../core/model/types';
import { releaseObjectUrls } from '../core/opc/objectUrls';
import { releaseEmbeddedFonts } from '../core/render/embeddedFonts';
import { releaseThumbnails, cacheThumbnail } from './thumbnailCache';
import { schedulePreview } from './previewScheduler';
import { abortError } from './abortError';

export function releasePreparedDeck(deck: Deck) {
  releaseThumbnails(deck.pkg);
  releaseObjectUrls(deck.pkg);
  releaseEmbeddedFonts(deck.pkg);
}

type Prepared = { deck: Deck; bytes: number; url: string };
type Pending = {
  url: string;
  controller: AbortController;
  foreground: boolean;
  promise: Promise<Prepared>;
};

/** Owns only speculative documents. Opening transfers ownership to the editor.
 * Never stores or evicts a live document's edits/undo stack. */
export class PresentationLoader {
  private cached = new Map<string, Prepared>();
  private pending = new Map<string, Pending>();
  private previews = new Map<string, () => void>();
  private readonly maxBytes: number;
  constructor(maxBytes = 24 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  private take(id: string, url: string) {
    const cached = this.cached.get(id);
    this.cached.delete(id);
    this.previews.get(id)?.();
    this.previews.delete(id);
    if (cached?.url === url) return cached;
    if (cached) releasePreparedDeck(cached.deck);
  }

  private start(id: string, url: string, foreground: boolean): Pending {
    const existing = this.pending.get(id);
    if (
      existing &&
      existing.url === url &&
      !existing.controller.signal.aborted
    ) {
      existing.foreground ||= foreground;
      return existing;
    }
    existing?.controller.abort();
    const controller = new AbortController();
    const promise = (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok)
        throw new Error(`Document fetch failed (${response.status})`);
      const contentLength = Number(
        response.headers?.get('Content-Length') || 0
      );
      if (!this.pending.get(id)?.foreground && contentLength > this.maxBytes)
        throw new Error('Document exceeds the background preparation budget');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { prepareInWorker } = await import('./packageWorker');
      const prepared = await prepareInWorker(
        bytes,
        controller.signal,
        () => !!this.pending.get(id)?.foreground
      );
      if (
        !this.pending.get(id)?.foreground &&
        prepared.estimatedBytes > this.maxBytes
      )
        throw new Error('Document exceeds the background preparation budget');
      const [{ OPCPackage }, { importPreparedDeck }] = await Promise.all([
        import('../core/opc/package'),
        import('../core/model/import')
      ]);
      if (controller.signal.aborted) throw abortError();
      const deck = importPreparedDeck(
        new OPCPackage(prepared.parts, prepared.trees)
      );
      return { deck, bytes: prepared.estimatedBytes, url };
    })().finally(() => {
      if (this.pending.get(id)?.controller === controller)
        this.pending.delete(id);
    });
    const job: Pending = { url, controller, foreground, promise };
    this.pending.set(id, job);
    return job;
  }

  cancelBackground(exceptId?: string) {
    for (const [id, job] of this.pending)
      if (id !== exceptId && !job.foreground) job.controller.abort();
    for (const cancel of this.previews.values()) cancel();
    this.previews.clear();
  }

  prioritize(id?: string) {
    const job = id ? this.pending.get(id) : undefined;
    if (job) job.foreground = true;
    this.cancelBackground(id);
  }

  async load(id: string, url: string, signal: AbortSignal): Promise<Deck> {
    // No await between prioritize and start: a settling prefetch must not slip
    // in and drop its prepared deck (leak + re-fetch) before we take/claim it.
    this.prioritize(id);
    if (signal.aborted) throw abortError();
    const cached = this.take(id, url);
    if (cached) return cached.deck;
    const job = this.start(id, url, true);
    const cancel = () => job.controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await job.promise;
      if (signal.aborted) {
        releasePreparedDeck(result.deck);
        throw abortError();
      }
      return result.deck;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async prefetch(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.cached.get(id)?.url === url) return;
    const job = this.start(id, url, false);
    const cancel = () => {
      if (!job.foreground) job.controller.abort();
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await job.promise;
      // An interactive load may have taken over the exact same request.
      if (job.foreground) return;
      if (signal.aborted || result.bytes > this.maxBytes) {
        releasePreparedDeck(result.deck);
        return;
      }
      const previous = this.cached.get(id);
      if (previous) releasePreparedDeck(previous.deck);
      this.cached.set(id, result);
      let total = [...this.cached.values()].reduce(
        (sum, item) => sum + item.bytes,
        0
      );
      while (this.cached.size > 2 || total > this.maxBytes) {
        const oldest = this.cached.keys().next().value as string;
        const evicted = this.cached.get(oldest);
        this.previews.get(oldest)?.();
        this.previews.delete(oldest);
        this.cached.delete(oldest);
        if (evicted) {
          total -= evicted.bytes;
          releasePreparedDeck(evicted.deck);
        }
      }
      await this.prepareThumbnails(id, result, signal);
    } catch {
      // A speculative failure never blocks the active document. Selecting the
      // failed tab retries through load(), which surfaces the actual error.
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  private async prepareThumbnails(
    id: string,
    result: Prepared,
    signal: AbortSignal
  ) {
    const { renderSlideSvg } = await import('../core/render/svg');
    if (signal.aborted || this.cached.get(id) !== result) return;
    await new Promise<void>((resolve) => {
      let index = 0;
      let cancelJob = () => {};
      const finish = () => {
        cancelJob();
        this.previews.delete(id);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const next = () => {
        if (
          signal.aborted ||
          this.cached.get(id) !== result ||
          index >= Math.min(5, result.deck.slides.length)
        ) {
          finish();
          return;
        }
        cancelJob = schedulePreview(() => {
          const slide = result.deck.slides[index++];
          try {
            cacheThumbnail(
              result.deck.pkg,
              slide.path,
              1,
              renderSlideSvg(result.deck, slide)
            );
          } catch {
            finish();
            return;
          }
          next();
        }, true);
      };
      signal.addEventListener('abort', finish, { once: true });
      this.previews.set(id, finish);
      next();
    });
  }

  dispose() {
    this.cancelBackground();
    for (const job of this.pending.values()) job.controller.abort();
    this.pending.clear();
    for (const item of this.cached.values()) releasePreparedDeck(item.deck);
    this.cached.clear();
  }
}
