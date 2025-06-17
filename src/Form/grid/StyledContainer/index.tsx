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
import { replaceTextVariables } from '../../../elements/components/TextNodes';
import { ShadowDomHtmlContent } from '../../../utils/ShadowDomHtmlContent';

export type StyledContainerProps = PropsWithChildren & {
  key?: string;
  node: any;
  raw?: any;
  css?: any;
  component?: any;
  viewport?: 'desktop' | 'mobile';
  [key: string]: any;
  viewportOnly?: boolean;
};

/**
 * StyledContainer
 * This component applies all of the style properties to "Containers" which are used
 * around elements and other "Containers". This component is used by both hosted forms
 * and the editor to render "Containers".
 */
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
      viewportOnly ? viewport : undefined
    );
    if (backgroundImage) styles.backgroundImage = backgroundImage;

    const [isFixed, fixedContainerRef] = useFixedContainer(
      node,
      rawNode,
      viewport
    );

    if (node.properties.iframe_url) {
      const url = replaceTextVariables(node.properties.iframe_url);
      children.push(
        <iframe
          key={`iframe:${url}`}
          width='100%'
          height='100%'
          src={url}
          css={{ border: 'none' }}
        />
      );
    }

    if (node.properties.custom_html) {
      const html = replaceTextVariables(node.properties.custom_html);

      const RenderComponent = editMode
        ? ShadowDomHtmlContent // render inside shadow dom in designer
        : DangerouslySetHtmlContent; // render directly on live form
      const baseStyles =
        children.length === 0 ? { height: '100%', width: '100%' } : {};
      children.push(
        <RenderComponent key={`html:${html}`} html={html} css={baseStyles} />
      );
    }

    useContainerEngine(node, rawNode, ref);

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
          data-id={node.id}
          data-feathery-id={node.key}
          {...props}
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
);

export { getCellStyle };
