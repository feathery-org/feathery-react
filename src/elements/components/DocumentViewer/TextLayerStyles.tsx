import React from 'react';
import { Global, css } from '@emotion/react';

// Ported from pdf.js 5.4.296's web/text_layer_builder.css (the pinned CDN
// version — see pdfjsLoader.ts). Jest's default config cannot parse raw CSS
// imports and the rollup/webpack build pipeline for this package does not
// process CSS either, so these rules are injected as an emotion global style
// instead of importing the stylesheet directly. Keep this scoped to the
// DocumentViewer lazy chunk.
//
// Only the text layer needs styling: review is read-only, so no interactive
// widget layer is rendered (field values are baked into the canvas by the
// print-intent render in DocumentCanvas.tsx) and the annotation-layer rules
// this file used to carry had nothing left to style.
//
// pdf.js sizes the layer via `setLayerDimensions`, which reads the
// `--scale-factor` custom property from the layer div itself (set at render
// time in DocumentCanvas.tsx/PageThumbnails.tsx), not from this stylesheet.
export default function TextLayerStyles() {
  return (
    <Global
      styles={css`
        /* Transparent, selectable text positioned over the canvas so screen
           readers and copy/paste can reach the document's real text. */
        .textLayer {
          --scale-factor: 1;
          position: absolute;
          text-align: initial;
          inset: 0;
          overflow: clip;
          opacity: 1;
          line-height: 1;
          -webkit-text-size-adjust: none;
          -moz-text-size-adjust: none;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          caret-color: CanvasText;
          z-index: 2;
        }
        .textLayer :is(span, br) {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
        .textLayer span.markedContent {
          top: 0;
          height: 0;
        }
        .textLayer ::selection {
          background: rgba(0, 0, 255, 0.25);
        }
        .textLayer br::selection {
          background: transparent;
        }
      `}
    />
  );
}
