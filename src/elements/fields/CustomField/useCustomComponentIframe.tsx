import { useEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';
import { createTemplate } from './template';

interface Props {
  componentCode: string;
  elementId: string;
  value: string;
  onChange?: (value: string) => void;
  customProps?: Record<string, any>;
}

interface Result {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  error: string | null;
  loading: boolean;
}

export function useCustomComponentIframe({
  componentCode,
  elementId,
  value,
  onChange,
  customProps
}: Props): Result {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const rootRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const renderComponent = (overrideLoading = false) => {
    const iframe = iframeRef.current;
    if (!iframe || !rootRef.current || (loading && !overrideLoading)) return;

    const root = rootRef.current;
    const React = (iframe.contentWindow as any)?.React;
    const UserComponent = (iframe.contentWindow as any)?.UserComponent;

    if (React && UserComponent) {
      const handleChange = (newValue: string) => {
        iframe.contentWindow?.parent.postMessage(
          {
            type: 'valueChange',
            value: newValue,
            elementId
          },
          featheryWindow().location.origin
        );
      };

      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(UserComponent, {
            value,
            onChange: handleChange,
            ...customProps
          })
        )
      );
    }
  };

  // Create iframe whenever code changes
  useEffect(() => {
    const setupIframe = async () => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      try {
        setLoading(true);

        const template = createTemplate(componentCode, value, elementId);

        const handleMessage = (event: MessageEvent) => {
          // Verify the message is intended for this element
          if (event.data?.elementId !== elementId) return;

          if (event.data.type === 'LOADING_COMPLETE') {
            setLoading(false);
            setError(null);
            rootRef.current = (iframe.contentWindow as any)?.rootRef;
            renderComponent(true);
          } else if (event.data?.error) {
            setError(event.data.error);
            setLoading(false);
          } else if (event.data?.type === 'resize' && iframe) {
            iframe.style.height = `${event.data.height}px`;
          } else if (event.data?.type === 'valueChange') {
            onChange?.(event.data.value);
          }
        };

        featheryWindow().addEventListener('message', handleMessage);
        iframe.srcdoc = template;

        return () => {
          featheryWindow().removeEventListener('message', handleMessage);
        };
      } catch (err) {
        const error = err as Error;
        setError(error.message);
        setLoading(false);
      }
    };

    setupIframe();
  }, [componentCode]);

  // Update component props when value changes
  useEffect(() => {
    renderComponent();
  }, [value, loading, customProps]);

  return {
    iframeRef,
    error,
    loading
  };
}
