import { ComponentProps } from 'react';
import { FORM_Z_INDEX } from '../../utils/styles';

interface TooltipProps extends ComponentProps<'div'> {
  css: Record<string, any>;
}

const Tooltip = ({ children, css, ...props }: TooltipProps) => {
  return (
    <div
      css={{
        zIndex: FORM_Z_INDEX + 1,
        padding: '.4rem 0',
        transition: 'opacity .10s linear',
        '.tooltip-inner': {
          maxWidth: '200px',
          padding: '.25rem .5rem',
          color: '#fff',
          textAlign: 'center',
          backgroundColor: '#000',
          borderRadius: '.25rem',
          fontSize: 'smaller'
        },
        ...css
      }}
      {...props}
    >
      <div className='tooltip-inner'>{children}</div>
    </div>
  );
};

export { Tooltip };
