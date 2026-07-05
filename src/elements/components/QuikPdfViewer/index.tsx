import React from 'react';
import './pdfSetup';

export interface ViewerDocument {
  type: 'form' | 'attachment';
  pdf_url: string;
  form_id?: string;
  group_index?: number;
  form_name?: string;
  name?: string;
  position?: 'before' | 'after';
}

export interface QuikViewerPayload {
  documents: ViewerDocument[];
  expires_at: string;
}

interface QuikPdfViewerProps {
  payload: QuikViewerPayload;
  action: Record<string, any>;
  client: any;
  setShow: (show: boolean) => void;
}

export default function QuikPdfViewer(props: QuikPdfViewerProps) {
  return <div data-testid='quik-pdf-viewer' />;
}
