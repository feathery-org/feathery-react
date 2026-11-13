import React, {
  forwardRef,
  PropsWithChildren,
  useEffect,
  useState
} from 'react';
import {
  useContainerEngine,
  useContainerStyles,
  useFormattedNode,
  useNodeType
} from './hooks';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { getCellStyle } from './styles';
import { useFixedContainer } from './hooks/useFixedContainer';
import classNames from 'classnames';
import { fieldValues } from '../../../utils/init';
import { getRenderData } from '../../../utils/image';
import DangerouslySetHtmlContent from '../../../utils/DangerouslySetHTMLContent';
import {
  replaceTextVariables,
  TEXT_VARIABLE_PATTERN
} from '../../../elements/components/TextNodes';
import DocumentEditorContainer from '../../../elements/components/DocumentEditor/DocumentEditorContainer';
import { ShadowDomHtmlContent } from '../../../utils/ShadowDomHtmlContent';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const EDITOR_IFRAME_PROTOCOLS = ['http:', 'https:'];

// The editor renders inside the dashboard's own page, so it embeds only a web
// page that is not the dashboard itself.
function canEmbedInEditor(url: string): boolean {
  if (!url) return false;

  const link = featheryDoc().createElement?.('a');
  if (!link) return false;
  link.href = url;

  // A javascript: or data: URL would run as the signed-in member.
  if (!EDITOR_IFRAME_PROTOCOLS.includes(link.protocol)) return false;

  // An unresolved variable can leave a URL pointing at the dashboard's own
  // origin, which would load the dashboard inside its editor.
  const hasUnresolvedVariable = Boolean(url.match(TEXT_VARIABLE_PATTERN));
  const isDashboardOrigin = link.origin === featheryWindow().location.origin;
  return !(hasUnresolvedVariable && isDashboardOrigin);
}

export type StyledContainerProps = PropsWithChildren & {
  key?: string;
  node: any;
  raw?: any;
  css?: any;
  component?: any;
  viewport?: 'desktop' | 'mobile';
  [key: string]: any;
  viewportOnly?: boolean;
  breakpoint: number;
  documentEditorPreviewType?: 'docx' | 'pptx' | 'generic';
  /**
   * Editor mode shares the host's page, so it renders custom HTML only as
   * this function returns it, and none without it. Live forms ignore it.
   */
  sanitizeHtml?: (html: string) => string;
};

/**
 * StyledContainer
 * This component applies all of the style properties to "Containers" which are used
 * around elements and other "Containers". This component is used by both hosted forms
 * and the editor to render "Containers".
 */
type StyledContainerComponent = (
  props: Omit<StyledContainerProps, 'ref'> & React.RefAttributes<HTMLDivElement>
) => React.ReactElement | null;

export const StyledContainer = forwardRef<HTMLDivElement, StyledContainerProps>(
  (
    {
      node: _node,
      raw,
      css = {},
      viewport,
      component,
      children: _children,
      className,
      viewportOnly = false,
      editMode = false,
      breakpoint,
      formId,
      assistantEnabled,
      documentEditorPreviewType,
      sanitizeHtml,
      ...props
    },
    ref
  ) => {
    const { node, rawNode } = useFormattedNode(_node, raw);
    const children = React.Children.toArray(_children);

    const type = useNodeType(node, rawNode, viewport);

    const [backgroundImage, setBackgroundImage] = useState('');

    const imageUrlFieldKey = node.styles?.uploaded_image_file_field_key;
    let file: any;
    if (imageUrlFieldKey) {
      file = fieldValues[imageUrlFieldKey];
      if (Array.isArray(file)) file = file[node.repeat ?? 0];
    }

    useEffect(() => {
      if (!backgroundImage && !file) return;
      if (!file) setBackgroundImage('');
      else if (typeof file === 'string') {
        setBackgroundImage(`url(${file})`);
      } else {
        getRenderData(file).then((data) => {
          setBackgroundImage(`url(${data.url})`);
        });
      }
    }, [file]);

    const { styles, innerStyles } = useContainerStyles(
      node,
      rawNode,
      css,
      viewportOnly ? viewport : undefined,
      breakpoint
    );
    if (backgroundImage) styles.backgroundImage = backgroundImage;

    const [isFixed, fixedContainerRef] = useFixedContainer(
      node,
      rawNode,
      viewport,
      breakpoint
    );

    const url = replaceTextVariables(node.properties.iframe_url);
    const blockEditorIframe = editMode && !canEmbedInEditor(url);
    if (node.properties.iframe_url && !blockEditorIframe) {
      children.push(
        <iframe
          key={`iframe:${url}`}
          width='100%'
          height='100%'
          src={url}
          scrolling='auto'
          css={{
            border: 'none',
            display: 'block',
            flex: '1 1 auto',
            height: '100%',
            maxHeight: '100%',
            minHeight: 0,
            overflow: 'auto',
            width: '100%'
          }}
        />
      );
    }

    if (node.properties.document_editor) {
      children.push(
        <DocumentEditorContainer
          key={`docx:${node.id}`}
          containerId={node.id}
          formId={formId}
          editMode={editMode}
          previewType={documentEditorPreviewType}
          assistantEnabled={assistantEnabled}
        />
      );
    }

    if (node.properties.custom_html) {
      const html = replaceTextVariables(node.properties.custom_html);
      const baseStyles =
        children.length === 0 ? { height: '100%', width: '100%' } : {};

      if (!editMode) {
        // Live forms run the author's HTML as written, scripts included.
        children.push(
          <DangerouslySetHtmlContent
            key={`html:${html}`}
            html={html}
            css={baseStyles}
          />
        );
      } else if (sanitizeHtml) {
        // A shadow root scopes styles, not script. Sanitizing after the
        // variables are substituted keeps a field value from adding markup.
        const sanitizedHtml = sanitizeHtml(html);
        children.push(
          <ShadowDomHtmlContent
            key={`html:${sanitizedHtml}`}
            html={sanitizedHtml}
            css={baseStyles}
          />
        );
      }
    }

    useContainerEngine(node, rawNode, ref);

    const elementType = node.servar?.type ?? node.type;

    if (component) {
      const Component = component;

      return (
        <Component
          key={node.id}
          ref={ref}
          node={_node}
          css={styles}
          className={classNames('styled-container', type, className)}
          {...props}
        >
          {/* An inner container is required to properly size px-height
            elements as the outer container is dependent on content size. */}
          <div className='inner-container' css={innerStyles}>
            {children}
          </div>
        </Component>
      );
    }

    return (
      <>
        {isFixed && (
          <div
            key={`${node.id}-fixed`}
            className={classNames('styled-container', type, className)}
            {...props}
            css={{
              ...styles,
              position: 'fixed',
              zIndex: FORM_Z_INDEX + 1
            }}
            ref={fixedContainerRef}
            data-feathery-id={node.key}
            data-element={elementType}
          >
            <div className='inner-container' css={innerStyles}>
              {children}
            </div>
          </div>
        )}
        <div
          key={node.id}
          ref={ref}
          css={isFixed ? { ...styles, visibility: 'hidden' } : styles}
          className={classNames('styled-container', type, className)}
          {...props}
          data-id={node.id}
          data-feathery-id={node.key}
          data-element={elementType}
        >
          {/* An inner container is required to properly size px-height
            elements as the outer container is dependent on content size. */}
          <div className='inner-container' css={innerStyles}>
            {isFixed ? null : children}
          </div>
        </div>
      </>
    );
  }
) as StyledContainerComponent;

export { getCellStyle };
