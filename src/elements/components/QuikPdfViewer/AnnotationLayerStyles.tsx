import React from 'react';
import { Global, css } from '@emotion/react';

// Ported from react-pdf/dist/Page/AnnotationLayer.css. Jest's default config
// cannot parse raw CSS imports and the rollup/webpack build pipeline for this
// package does not process CSS either, so the annotation-layer positioning
// rules are injected as an emotion global style instead of importing the
// stylesheet directly. Keep this scoped to the QuikPdfViewer lazy chunk.
export default function AnnotationLayerStyles() {
  return (
    <Global
      styles={css`
        .annotationLayer {
          position: absolute;
          top: 0;
          left: 0;
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
      `}
    />
  );
}
