// Make a freshly opened document safe to put a caret into.
//
// Syncfusion's content-control border renderer reads the control's colour with no
// guard at all (render.js renderContentControlBorder):
//
//   var color = contentControl.contentControlProperties.color;
//   ... getColor(color)   // -> color.length, on undefined
//
// so a content control with no colour throws the moment the caret enters it. The
// throw happens mid-paint, inside renderWidgets, which is why the symptom is not
// an error dialog but a half-drawn page: the clicked cell survives and the rest
// of the document vanishes until something forces a full repaint.
//
// Colour goes missing on every .docx round trip, and not by accident. `color` is a
// Syncfusion extension with no OOXML representation: their own docx writer
// serializes `w:tag` for a content control and never writes a colour
// (word-export.js serializeContentControl). So any document that has been saved
// and reopened - or that a template author built in Word - arrives with content
// controls that have tags but no colour, and clicking one crashes the render.
//
// This is deliberately NOT part of the bindings feature. Any .docx containing
// Word content controls hits it, whether or not bindings are on, so it runs on
// the ordinary open path.
//
// '#00000000' is transparent, which the renderer itself maps to grey - the same
// value used for controls this package creates, so a normalized control is
// indistinguishable from a native one.

export const DEFAULT_CONTENT_CONTROL_COLOR = '#00000000';

interface ControlLike {
  contentControlProperties?: { color?: string; [key: string]: unknown };
  /** The matching closing boundary, which carries its own properties. */
  reference?: ControlLike;
}

interface EditorLike {
  documentHelper?: {
    contentControlCollection?: ControlLike[];
    [key: string]: unknown;
  };
}

/**
 * Give every content control in the open document a colour if it lacks one.
 * Returns how many needed fixing, for logging.
 *
 * Call after the document is laid out (Syncfusion's `documentChange`), because
 * the collection is only populated then. Purely a property stamp: it changes no
 * text, marks nothing dirty, and authors no history entry.
 */
export function stampMissingContentControlColors(editor: unknown): number {
  let fixed = 0;
  try {
    const collection = (editor as EditorLike)?.documentHelper
      ?.contentControlCollection;
    if (!Array.isArray(collection)) return 0;
    for (const control of collection) {
      // Both boundary elements are rendered, and the reader can give them
      // separate property objects, so neither may be left without a colour.
      for (const element of [control, control?.reference]) {
        const properties = element?.contentControlProperties;
        if (!properties) continue;
        if (typeof properties.color !== 'string' || !properties.color) {
          properties.color = DEFAULT_CONTENT_CONTROL_COLOR;
          fixed += 1;
        }
      }
    }
  } catch {
    // A document that opens with an odd model must still open.
  }
  return fixed;
}
