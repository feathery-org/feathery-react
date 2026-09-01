import React from 'react';
import { Global, css } from '@emotion/react';

// Ported from pdf.js 5.4.296's web/pdf_viewer.css (the pinned CDN version —
// see pdfjsLoader.ts), trimmed to the rules the review editor's interactive
// form layer actually exercises: layer positioning, form widgets (text,
// checkbox, radio, choice), links, and text annotations. The comment-button
// and annotation-editor rules are omitted — the layer renders with
// enableComment/annotationEditorUIManager off, so those elements never exist.
//
// Jest's default config cannot parse raw CSS imports and the rollup/webpack
// build pipeline for this package does not process CSS either, so these rules
// are injected as an emotion global style instead of importing the stylesheet
// directly. Keep this scoped to the DocumentViewer lazy chunk.
//
// pdf.js sizes the layer via `setLayerDimensions`, which reads the
// `--scale-factor` CSS custom property from the layer div itself (set at
// render time in DocumentCanvas.tsx), not from this stylesheet —
// --scale-factor is only declared here as a safe default for any late paint
// before the first render call completes. --total-scale-factor is what 5.x's
// widget-sizing rules consume; pdf.js derives it from --scale-factor, so it
// is aliased here for the same pre-render window.
export default function AnnotationLayerStyles() {
  return (
    <Global
      styles={css`
        .annotationLayer {
          --scale-factor: 1;
          --total-scale-factor: var(--scale-factor);
          --annotation-unfocused-field-background: url("data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>");
          --input-focus-border-color: Highlight;
          --input-focus-outline: 1px solid Canvas;
          --input-unfocused-border-color: transparent;
          --input-disabled-border-color: transparent;
          --input-hover-border-color: black;

          position: absolute;
          top: 0;
          left: 0;
          pointer-events: none;
          transform-origin: 0 0;
          z-index: 3;
        }

        @media screen and (forced-colors: active) {
          .annotationLayer {
            --input-focus-border-color: CanvasText;
            --input-unfocused-border-color: ActiveText;
            --input-disabled-border-color: GrayText;
            --input-hover-border-color: Highlight;
          }
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

        .annotationLayer .annotationContent {
          position: absolute;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .annotationLayer section {
          position: absolute;
          text-align: initial;
          pointer-events: auto;
          box-sizing: border-box;
          margin: 0;
          transform-origin: 0 0;
          user-select: none;
        }

        .annotationLayer
          section:has(div.annotationContent)
          canvas.annotationContent {
          display: none;
        }

        .annotationLayer section .overlaidText {
          position: absolute;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          display: inline-block;
          overflow: hidden;
        }

        .textLayer.selecting ~ .annotationLayer section {
          pointer-events: none;
        }

        .annotationLayer .linkAnnotation {
          outline: none;
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

        .annotationLayer
          :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton):not(.hasBorder)
          > a:hover {
          opacity: 0.2;
          background-color: rgb(255 255 0);
        }

        .annotationLayer .linkAnnotation.hasBorder:hover {
          background-color: rgb(255 255 0 / 0.2);
        }

        .annotationLayer .hasBorder {
          background-size: 100% 100%;
        }

        .annotationLayer .textAnnotation img {
          position: absolute;
          cursor: pointer;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea),
        .annotationLayer .choiceWidgetAnnotation select,
        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input {
          background-image: var(--annotation-unfocused-field-background);
          border: 2px solid var(--input-unfocused-border-color);
          box-sizing: border-box;
          font: calc(9px * var(--total-scale-factor)) sans-serif;
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

        .annotationLayer .textWidgetAnnotation [disabled]:is(input, textarea),
        .annotationLayer .choiceWidgetAnnotation select[disabled],
        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input[disabled] {
          background: none;
          border: 2px solid var(--input-disabled-border-color);
          cursor: not-allowed;
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea):hover,
        .annotationLayer .choiceWidgetAnnotation select:hover,
        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input:hover {
          border: 2px solid var(--input-hover-border-color);
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea):hover,
        .annotationLayer .choiceWidgetAnnotation select:hover,
        .annotationLayer .buttonWidgetAnnotation.checkBox input:hover {
          border-radius: 2px;
        }

        .annotationLayer .textWidgetAnnotation :is(input, textarea):focus,
        .annotationLayer .choiceWidgetAnnotation select:focus {
          background: none;
          border: 2px solid var(--input-focus-border-color);
          border-radius: 2px;
          outline: var(--input-focus-outline);
        }

        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          :focus {
          background-image: none;
          background-color: transparent;
        }

        .annotationLayer .buttonWidgetAnnotation.checkBox :focus {
          border: 2px solid var(--input-focus-border-color);
          border-radius: 2px;
          outline: var(--input-focus-outline);
        }

        .annotationLayer .buttonWidgetAnnotation.radioButton :focus {
          border: 2px solid var(--input-focus-border-color);
          outline: var(--input-focus-outline);
        }

        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked::before,
        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after,
        .annotationLayer
          .buttonWidgetAnnotation.radioButton
          input:checked::before {
          background-color: CanvasText;
          content: '';
          display: block;
          position: absolute;
        }

        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked::before,
        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after {
          height: 80%;
          left: 45%;
          width: 1px;
        }

        .annotationLayer
          .buttonWidgetAnnotation.checkBox
          input:checked::before {
          transform: rotate(45deg);
        }

        .annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after {
          transform: rotate(-45deg);
        }

        .annotationLayer
          .buttonWidgetAnnotation.radioButton
          input:checked::before {
          border-radius: 50%;
          height: 50%;
          left: 25%;
          top: 25%;
          width: 50%;
        }

        .annotationLayer .textWidgetAnnotation input.comb {
          font-family: monospace;
          padding-left: 2px;
          padding-right: 0;
        }

        .annotationLayer .textWidgetAnnotation input.comb:focus {
          width: 103%;
        }

        .annotationLayer
          .buttonWidgetAnnotation:is(.checkBox, .radioButton)
          input {
          appearance: none;
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

        .annotationLayer svg.quadrilateralsContainer {
          contain: strict;
          width: 0;
          height: 0;
          position: absolute;
          top: 0;
          left: 0;
          z-index: -1;
        }
      `}
    />
  );
}
