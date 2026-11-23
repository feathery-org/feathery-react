import type { Seam } from '../../../pack';
import type { EditorCommand } from '../../../../../elements/components/PptxEditor/engine/commands';
import type { PptxHost } from '../host';

/** A slide by its part path, or one this write adds, by the name the plan gave it */
export type SlideRef = string | { ref: string };
/** A shape by its id on its slide, or one this write adds */
export type ShapeRef = string | { ref: string };

type WithoutTarget<C> = C extends unknown
  ? Omit<C, 'slideId' | 'shapeId' | 'duplicateOf'>
  : never;

export type PlannedCommand = WithoutTarget<EditorCommand> & {
  onSlide?: SlideRef;
  onShape?: ShapeRef;
  copyOf?: SlideRef;
};

export interface DeckOperation {
  command: PlannedCommand;
  creates?: { slide?: string; shape?: string };
}

/** Every operation of a write as one editor transaction: one undo step and one suggestion */
export const deckSeam: Seam = {
  apply(host, payload, ctx) {
    const { store } = host as PptxHost;
    const operations = payload as DeckOperation[];
    const named = new Map<string, string>();
    const resolve = (ref: SlideRef | ShapeRef | undefined) => {
      if (ref === undefined || typeof ref === 'string') return ref;
      const id = named.get(ref.ref);
      if (!id) throw new Error(`Nothing was added under ${ref.ref}`);
      return id;
    };
    const slidePaths = () =>
      store.engine.readDeck()?.slides.map((slide) => slide.path) ?? [];
    const shapeIds = (path: string) =>
      store.engine
        .readDeck()
        ?.slides.find((slide) => slide.path === path)
        ?.shapes.map((shape) => shape.id) ?? [];

    store.transaction(
      { origin: 'assistant', authorId: ctx.turnId, label: ctx.title },
      () => {
        for (const { command, creates } of operations) {
          const { onSlide, onShape, copyOf, ...rest } = command;
          const slideId = resolve(onSlide);
          const resolved = {
            ...rest,
            ...(slideId === undefined ? {} : { slideId }),
            ...(onShape === undefined ? {} : { shapeId: resolve(onShape) }),
            ...(copyOf === undefined ? {} : { duplicateOf: resolve(copyOf) })
          } as EditorCommand;
          const slidesBefore = slidePaths();
          const shapesBefore = slideId ? shapeIds(slideId) : [];
          store.engine.execute(resolved, {
            origin: 'assistant',
            authorId: ctx.turnId
          });
          if (creates?.slide) {
            const added = slidePaths().find(
              (path) => !slidesBefore.includes(path)
            );
            if (!added) throw new Error('The editor added no slide');
            named.set(creates.slide, added);
          }
          if (creates?.shape && slideId) {
            const added = shapeIds(slideId).find(
              (id) => !shapesBefore.includes(id)
            );
            if (!added) throw new Error('The editor added no shape');
            named.set(creates.shape, added);
          }
        }
      }
    );
  }
};
