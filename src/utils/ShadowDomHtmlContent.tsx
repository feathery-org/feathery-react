import React, { useEffect, useRef } from 'react';
import { featheryDoc } from './browser';

interface ShadowDomHtmlContentProps {
  html: string;
  css?: any;
  className?: string;
}

export const ShadowDomHtmlContent: React.FC<ShadowDomHtmlContentProps> = ({
  html,
  css = {},
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!shadowRootRef.current) {
      shadowRootRef.current = containerRef.current.attachShadow({
        mode: 'open'
      });
    }

    const shadowRoot = shadowRootRef.current;

    const wrapper = featheryDoc().createElement('div');

    Object.assign(wrapper.style, {
      height: '100%',
      width: '100%',
      boxSizing: 'border-box',
      ...css
    });

    wrapper.innerHTML = html;

    const style = featheryDoc().createElement('style');
    style.textContent = `
      :host {
        display: block;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
      }
      
      * {
        box-sizing: border-box;
      }
    `;

    shadowRoot.innerHTML = '';
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(wrapper);

    return () => {
      if (shadowRoot) {
        shadowRoot.innerHTML = '';
      }
    };
  }, [html, css]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: '100%',
        width: '100%',
        display: 'block'
      }}
    />
  );
};
