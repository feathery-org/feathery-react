import { ComponentProps } from 'react';
import { FORM_Z_INDEX } from '../../utils/styles';
import type { Interpolation, Theme } from '@emotion/react';

interface TooltipProps extends ComponentProps<'div'> {
  css?: Interpolation<Theme>;
  maxWidth?: string;
}

const Tooltip = ({
  children,
  css,
  maxWidth = '200px',
  ...props
}: TooltipProps) => {
  return (
    <div
      css={{
        zIndex: FORM_Z_INDEX + 1,
        padding: '.4rem 0',
        transition: 'opacity .10s linear',
        '.tooltip-inner': {
          maxWidth,
          padding: '.25rem .5rem',
          color: '#fff',
          textAlign: 'center',
          backgroundColor: '#000',
          borderRadius: '.25rem',
          fontSize: 'smaller',
          // break long unbroken words so they wrap instead of overflowing
          overflowWrap: 'anywhere'
        },
        ...(css as any)
      }}
      {...props}
    >
      <div className='tooltip-inner'>{children}</div>
    </div>
  );
};

export { Tooltip };
