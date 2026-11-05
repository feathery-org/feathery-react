import React from 'react';
import { LabelRun } from '../utils/fieldLabelRuns';

/**
 * Renders a field label's text. Formatted runs become spans that override
 * only what they set, so the label's own typography shows through. Every
 * span carries `data-index` so builder text selection and edits can map DOM
 * nodes back to runs.
 */
export default function FieldLabelRuns({
  label,
  runs,
  responsiveStyles
}: {
  label: string;
  runs: LabelRun[] | null;
  responsiveStyles: any;
}) {
  if (!runs) return <span data-index={0}>{label}</span>;
  return (
    <>
      {runs.map((run, i) => (
        <span
          key={i}
          data-index={i}
          css={responsiveStyles.getRichFontStyles(run.attributes ?? {}, {
            inherit: true,
            fallbackKey: 'label_font_fallback'
          })}
        >
          {run.insert}
        </span>
      ))}
    </>
  );
}
