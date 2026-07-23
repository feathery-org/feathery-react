import { FC, SVGAttributes } from 'react';

// Builder-parity typed file glyphs: page outline + 3-letter label, colored
// per type (attachmentIcon.tsx in the dashboard's builder chrome)

type AttachmentIconComponent = FC<SVGAttributes<SVGElement>>;

function FilePageGlyph({
  label,
  ...props
}: SVGAttributes<SVGElement> & { label: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
        stroke='currentColor'
        strokeWidth={1.75}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14 2v6h6'
        stroke='currentColor'
        strokeWidth={1.75}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <text
        x={12}
        y={18}
        textAnchor='middle'
        fontSize={6}
        fontWeight={700}
        fontFamily='ui-sans-serif, system-ui, -apple-system, sans-serif'
        letterSpacing={-0.2}
        fill='currentColor'
        stroke='none'
      >
        {label}
      </text>
    </svg>
  );
}

const PdfIcon: AttachmentIconComponent = (props) => (
  <FilePageGlyph label='PDF' {...props} />
);
const WordIcon: AttachmentIconComponent = (props) => (
  <FilePageGlyph label='DOC' {...props} />
);
const ExcelIcon: AttachmentIconComponent = (props) => (
  <FilePageGlyph label='XLS' {...props} />
);
const PowerpointIcon: AttachmentIconComponent = (props) => (
  <FilePageGlyph label='PPT' {...props} />
);
const CsvIcon: AttachmentIconComponent = (props) => (
  <FilePageGlyph label='CSV' {...props} />
);

export function getAttachmentIcon(file: {
  type?: string;
  name?: string | null;
}): { Icon: AttachmentIconComponent; color: string } | null {
  const mime = file.type ?? '';
  const ext = file.name?.split('.').pop()?.toLowerCase() ?? '';

  if (
    mime === 'application/msword' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/rtf' ||
    mime === 'text/rtf' ||
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'rtf'
  ) {
    return { Icon: WordIcon, color: '#38bdf8' };
  }
  if (
    mime === 'application/vnd.ms-excel' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel.sheet.macroEnabled.12' ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'xlsm'
  ) {
    return { Icon: ExcelIcon, color: '#34d399' };
  }
  if (
    mime === 'application/vnd.ms-powerpoint' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'ppt' ||
    ext === 'pptx'
  ) {
    return { Icon: PowerpointIcon, color: '#fb923c' };
  }
  if (mime === 'text/csv' || ext === 'csv') {
    return { Icon: CsvIcon, color: '#2dd4bf' };
  }
  // PDF check last so a converted Office doc (mediaType application/pdf) keys off its original extension
  if (mime === 'application/pdf' || ext === 'pdf') {
    return { Icon: PdfIcon, color: '#fb7185' };
  }

  return null;
}
