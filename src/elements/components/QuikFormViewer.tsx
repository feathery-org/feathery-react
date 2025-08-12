import React, { useEffect, useRef } from 'react';
import { featheryDoc, featheryWindow } from '../../utils/browser';
import { generateHeaderElement } from './QuikFormViewer/transforms/header';
import { generateFormElement } from './QuikFormViewer/transforms/form';
import { generateSidebarElement } from './QuikFormViewer/transforms/sidebar';
import FeatheryClient from '../../utils/featheryClient';

const MIN_DOC_SCALE = 0.4;
interface FrameProps {
  html?: string;
  css?: any;
  inline?: boolean;
  setShow?: (val: boolean) => void;
  formKey?: string;
}

function QuikFormViewer({
  html,
  css,
  setShow = () => {},
  inline,
  formKey
}: FrameProps) {
  const [htmlContent, setHtmlContent] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const fetchedRef = React.useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // calculate the scale of the document to fit without x-scroll
  // use transform scale to handle resizing of text and controls
  const scaleDocument = (doc: Document) => {
    const pageList = doc.querySelector('#QFVPageList') as HTMLUListElement;
    if (!pageList) {
      return;
    }
    const parentWidth = pageList.parentElement?.clientWidth || 0;
    const unscaledWidth = pageList.scrollWidth;
    const targetScale = parentWidth / unscaledWidth;

    pageList.style.transformOrigin = 'top left';
    pageList.style.transform = `scale(${Math.max(targetScale, MIN_DOC_SCALE)})`;
  };

  useEffect(() => {
    if (inline && formKey) {
      if (fetchedRef.current) return; // Prevent multiple fetches
      fetchedRef.current = true;
      const action = {
        type: '',
        auth_user_id: '',
        review_action: '',
        form_fill_type: 'html',
        sign_callback_url: ''
      };

      new FeatheryClient(formKey)
        .generateQuikEnvelopes(action)
        .then((payload: any) => {
          if (payload.error) {
            console.error('Error generating Quik envelopes:', payload.error);
          } else if (action.form_fill_type === 'html' && payload.html) {
            setHtmlContent(processHtml(payload.html, true));
          }
        });
    }
  }, [inline, formKey]);

  useEffect(() => {
    if (html) {
      setHtmlContent(processHtml(html));
    }
  }, [html]);

  useEffect(() => {
    featheryDoc().body.style.overflow = 'hidden';

    return () => {
      featheryDoc().body.style.removeProperty('overflow');
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'QUIK_BACK_BUTTON_CLICK') {
        featheryWindow().QuikFeatheryBackAction();
        setShow(false);
      }
    };

    featheryWindow().addEventListener('message', handleMessage);
    return () => {
      featheryWindow().removeEventListener('message', handleMessage);
    };
  }, [setShow]);

  // resize the document pdf on load and resize
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const scale = () => {
      const currIframe = iframeRef.current;
      if (currIframe && currIframe.contentDocument) {
        scaleDocument(currIframe.contentDocument);
        setLoaded(true);
      }
    };

    iframe.addEventListener('load', scale);
    window.addEventListener('resize', scale);

    return () => {
      iframe.removeEventListener('load', scale);
      window.removeEventListener('resize', scale);
    };
  }, [htmlContent]);

  if (!htmlContent) return <div>Loading...</div>;

  return (
    <div
      ref={containerRef}
      css={
        inline
          ? { width: '100%', height: '100%', overflow: 'hidden' }
          : {
              position: 'fixed',
              left: 0,
              backgroundColor: '#fff',
              minWidth: '100vw',
              height: '100vh',
              overflow: 'hidden',
              zIndex: 9999
            }
      }
    >
      {(!htmlContent || !loaded) && (
        <div
          css={{
            position: 'absolute'
          }}
        >
          Loading...
        </div>
      )}
      {htmlContent && (
        <iframe
          ref={iframeRef}
          src='about:blank'
          srcDoc={htmlContent}
          style={{ opacity: loaded ? 1 : 0 }}
          css={
            inline
              ? {
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  outline: 'none',
                  margin: 0,
                  padding: 0,
                  ...css
                }
              : {
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  outline: 'none',
                  margin: 0,
                  padding: 0,
                  ...css
                }
          }
        />
      )}
    </div>
  );
}

const processHtml = (rawHtml: string, inline?: boolean): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Disable scrolling on iframe <html> to fix floating back button UI issue
  const styleTag = doc.createElement('style');
  styleTag.innerHTML = `
      html {
        overflow: hidden !important;
      }

      #alt-popup {
        flex-direction: column;
        }
      body > div {
        display: flex;
        width: 100vw;
        height: 100vh;
        flex-direction: column;
      }

      body > div > table {
        display: contents;
      }

      #modalBoxes #prepareToSignDialog {
        flex-direction: column;
            position: absolute;
    top: 50%;
    transform: translateY(-50%);
    max-width: 80%;
    height: auto !important;
    max-height: 80%;
      }
      #modalBoxes #mask {
        width: 100vw;
        height: 100vh;
        top: 0;
      }
    `;
  doc.head.prepend(styleTag);

  const header = generateHeaderElement(doc, inline);
  const form = generateFormElement(doc);
  const sidebar = generateSidebarElement(doc);

  // remove the body div's content and append the new header
  const bodyDiv = doc.body.querySelector('div');
  if (bodyDiv) {
    bodyDiv.innerHTML = '';
    if (header) {
      bodyDiv.appendChild(header);
    }
    const contentDiv = doc.createElement('div');
    contentDiv.style.flex = '1';
    contentDiv.style.overflow = 'auto';
    contentDiv.style.display = 'flex';
    bodyDiv.appendChild(contentDiv);
    if (form) {
      contentDiv.appendChild(form);
    }
    if (sidebar) {
      contentDiv.appendChild(sidebar);
    }
  }

  return doc.documentElement.outerHTML;
};

export default QuikFormViewer;
