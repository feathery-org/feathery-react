import React from 'react';
import { Global, css } from '@emotion/react';

// Ported from pdf.js 4.8.69's web/annotation_layer_builder.css (the pinned
// CDN version — see pdfjsLoader.ts). Jest's default config cannot parse raw
// CSS imports and the rollup/webpack build pipeline for this package does
// not process CSS either, so the annotation-layer positioning rules are
// injected as an emotion global style instead of importing the stylesheet
// directly. Keep this scoped to the QuikPdfViewer lazy chunk.
//
// pdf.js 4.x sizes the layer via `setLayerDimensions`, which reads the
// `--scale-factor` CSS custom property from the layer div itself (set at
// render time in DocumentScroll.tsx/PageThumbnails.tsx), not from this
// stylesheet — --scale-factor is only declared here as a safe default for
// any late paint before the first render call completes.
export default function AnnotationLayerStyles() {
  return (
    <Global
      styles={css`
        .annotationLayer {
          --scale-factor: 1;
          /* pdf.js's JS only ever sets --scale-factor on this element (see
             setLayerDimensions in pdf.mjs); --total-scale-factor is not a
             variable pdf.js itself defines, but the widget-sizing rules
             below were ported from an older stylesheet that expects it, so
             alias it here rather than rewriting every calc(). */
          --total-scale-factor: var(--scale-factor);
          position: absolute;
          inset: 0;
          pointer-events: none;
          transform-origin: 0 0;
          z-index: 3;
        }

        .annotationLayer[data-main-rotation='90'] .norotate {
          transform: rotate(270deg) translateX(-100%);
        }
        .annotationLayer[data-main-rotation='180'] .norotate {
          transform: rotate(180deg) translate(-100%, -100%);
        }
        .annotationLayer[data-main-rotation='270'] .norotate {
          transform: rotate(90deg) translateY(-100%);
        }

        .annotationLayer canvas {
          position: absolute;
          width: 100%;
          height: 100%;
        }

        .annotationLayer section {
          position: absolute;
          text-align: initial;
          pointer-events: auto;
          box-sizing: border-box;
          margin: 0;
          transform-origin: 0 0;
        }

        .annotationLayer .linkAnnotation {
          outline: none;
        }

        .textLayer.selecting ~ .annotationLayer section {
          pointer-events: none;
        }

        .annotationLayer
          :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton)
          > a {
          position: absolute;
          font-size: 1em;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea),
        .annotationLayer .choiceWidgetAnnotation select,
        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input {
          background-color: transparent;
          border: 2px solid transparent;
          box-sizing: border-box;
          font: calc(9px * var(--total-scale-factor, 1)) sans-serif;
          height: 100%;
          margin: 0;
          vertical-align: top;
          width: 100%;
        }

        .annotationLayer .choiceWidgetAnnotation select option {
          padding: 0;
        }

        .annotationLayer .buttonWidgetAnnotation.radioButton input {
          border-radius: 50%;
        }

        .annotationLayer .textWidgetAnnotation textarea {
          resize: none;
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea)[disabled],
        .annotationLayer .choiceWidgetAnnotation select[disabled],
        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input[disabled] {
          background: none;
          cursor: not-allowed;
        }

        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input {
          appearance: none;
        }

        /* Checked-state glyphs. With appearance: none the native
           checkmark/dot never paints, so without these rules toggling a
           checkbox has no visible effect. The checkmark is an inline SVG
           (thick rounded stroke, like Chrome's PDF editor) so it scales to
           the widget rect at any zoom; a font glyph can't track box size. */
        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.5 13.5 L9.5 18.5 L20 5' fill='none' stroke='%233b82f6' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
          background-size: 95% 95%;
        }

        .annotationLayer
          .buttonWidgetAnnotation.radioButton
          input:checked::before {
          background-color: CanvasText;
          content: '';
          display: block;
          position: absolute;
          border-radius: 50%;
          height: 50%;
          left: 25%;
          top: 25%;
          width: 50%;
        }

        .annotationLayer .popupTriggerArea {
          height: 100%;
          width: 100%;
        }

        .annotationLayer .popupWrapper {
          position: absolute;
          font-size: calc(9px * var(--total-scale-factor, 1));
          width: 100%;
          min-width: calc(180px * var(--total-scale-factor, 1));
          pointer-events: none;
        }

        .annotationLayer .popup {
          position: absolute;
          max-width: calc(180px * var(--total-scale-factor, 1));
          background-color: rgba(255, 255, 153, 1);
          box-shadow: 0 calc(2px * var(--total-scale-factor, 1))
            calc(5px * var(--total-scale-factor, 1)) rgba(136, 136, 136, 1);
          border-radius: calc(2px * var(--total-scale-factor, 1));
          padding: calc(6px * var(--total-scale-factor, 1));
          margin-left: calc(5px * var(--total-scale-factor, 1));
          cursor: pointer;
          font: message-box;
          white-space: normal;
          word-wrap: break-word;
          pointer-events: auto;
        }

        .annotationLayer section svg {
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
        }

        .annotationLayer .annotationTextContent {
          position: absolute;
          width: 100%;
          height: 100%;
          opacity: 0;
          color: transparent;
          user-select: none;
          pointer-events: none;
        }

        .annotationLayer .annotationTextContent span {
          width: 100%;
          display: inline-block;
        }

        /* Theme overrides so field widgets read as fillable inputs rather
           than invisible overlays on top of the flattened PDF. */
        .annotationLayer .textWidgetAnnotation input,
        .annotationLayer .textWidgetAnnotation textarea,
        .annotationLayer .choiceWidgetAnnotation select {
          border: 1px solid rgba(59, 130, 246, 0.45);
          border-radius: 2px;
          background-color: rgba(59, 130, 246, 0.06);
          font-family: inherit;
        }

        .annotationLayer input:focus,
        .annotationLayer select:focus,
        .annotationLayer textarea:focus {
          outline: 2px solid #3b82f6;
          background-color: white;
        }

        .annotationLayer .buttonWidgetAnnotation.checkBox input,
        .annotationLayer .buttonWidgetAnnotation.radioButton input {
          cursor: pointer;
          border: 1px solid rgba(59, 130, 246, 0.45);
          background-color: rgba(59, 130, 246, 0.06);
        }
      `}
    />
  );
}
