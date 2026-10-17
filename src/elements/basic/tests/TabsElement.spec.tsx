import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabsElement from '../TabsElement';
import ResponsiveStyles from '../../styles';

// jsdom does not expose the device hover capability used by this guard.
jest.mock('../../../utils/browser', () => ({
  ...jest.requireActual('../../../utils/browser'),
  hoverStylesGuard: (styles: any) => styles
}));

const entries = [
  { id: 'claims-tab', label: 'Claims', step_key: 'claim-history' },
  { id: 'summary-tab', label: 'Summary', step_key: 'ai-summary' }
];

describe('native dashboard Tabs', () => {
  it.each(['vertical', 'horizontal'])(
    'renders saved %s tabs and selects the real step key',
    async (direction) => {
      const user = userEvent.setup();
      const element = {
        id: 'underwriter-tabs',
        properties: { entries, direction, link_id: 'underwriter-navigation' },
        styles: { gap: 8 }
      };
      const onTabClick = jest.fn();
      render(
        <TabsElement
          element={element}
          responsiveStyles={new ResponsiveStyles(element, [], true)}
          stepKey='claim-history'
          onTabClick={onTabClick}
        />
      );

      const claims = screen.getByRole('button', { name: 'Claims' });
      const summary = screen.getByRole('button', { name: 'Summary' });
      expect(claims).toHaveClass('active');
      expect(summary).not.toHaveClass('active');
      expect(claims.parentElement).toHaveStyle({
        'flex-direction': direction === 'vertical' ? 'column' : 'row',
        gap: '8px'
      });
      await user.click(summary);
      expect(onTabClick).toHaveBeenCalledWith(entries[1], 1);
    }
  );

  it.each(['vertical', 'horizontal'])(
    'renders authored row padding and alignment for %s tabs',
    (direction) => {
      const element = {
        id: 'padded-tabs',
        properties: { entries, direction },
        styles: {
          inner_padding_top: 8,
          inner_padding_right: 12,
          inner_padding_bottom: 8,
          inner_padding_left: 12,
          text_align: 'left',
          selected_background_color: 'E8ECF0',
          selected_font_color: '173B66'
        },
        mobile_styles: { inner_padding_left: 4 }
      };
      const styles = new ResponsiveStyles(element, [], true);
      render(
        <TabsElement
          element={element}
          responsiveStyles={styles}
          stepKey='claim-history'
        />
      );
      const claims = screen.getByRole('button', { name: 'Claims' });
      expect(claims).toHaveStyle({
        'padding-top': '8px',
        'padding-inline-end': '12px',
        'padding-bottom': '8px',
        'padding-inline-start': '12px',
        'text-align': 'left',
        background: '#E8ECF0',
        color: '#173B66'
      });
      expect(claims.parentElement).not.toHaveStyle({ 'padding-left': '12px' });
      expect(styles.getTarget('tab', false, true)).toMatchObject({
        paddingTop: '8px',
        paddingInlineStart: '4px'
      });
    }
  );

  it('leaves unset row padding inherited while honoring an explicit zero', () => {
    const element = {
      id: 'partial-padding-tabs',
      properties: { entries, direction: 'vertical' },
      styles: { inner_padding_left: 0 }
    };
    const styles = new ResponsiveStyles(element, [], true);
    render(<TabsElement element={element} responsiveStyles={styles} />);
    expect(screen.getByRole('button', { name: 'Claims' })).toHaveStyle({
      'padding-inline-start': '0px'
    });
    expect(styles.getTarget('tab', true)).not.toHaveProperty('paddingTop');
  });

  it('keeps editor clicks from navigating the form', async () => {
    const user = userEvent.setup();
    const element = { id: 'tabs', properties: { entries }, styles: {} };
    const onTabClick = jest.fn();
    render(
      <TabsElement
        element={element}
        responsiveStyles={new ResponsiveStyles(element, [], true)}
        editMode='editable'
        stepKey='claim-history'
        onTabClick={onTabClick}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it('uses logical inline sides for asymmetric padding in RTL forms', () => {
    const element = {
      id: 'rtl-tabs',
      properties: { entries },
      styles: { inner_padding_left: 4, inner_padding_right: 16 }
    };
    render(
      <div dir='rtl'>
        <TabsElement
          element={element}
          responsiveStyles={new ResponsiveStyles(element, [], true)}
        />
      </div>
    );
    expect(screen.getByRole('button', { name: 'Claims' })).toHaveStyle({
      paddingInlineStart: '4px',
      paddingInlineEnd: '16px'
    });
  });
});
