import { render } from '@testing-library/react';
import { FeatheryCacheProvider } from '../emotionCache';

describe('FeatheryCacheProvider', () => {
  it('anchors emotion styles at the top of <head> so later user CSS wins specificity ties', () => {
    // Simulate a host page / custom CSS stylesheet already present in head
    const userStyle = document.createElement('style');
    userStyle.setAttribute('data-user-css', '');
    userStyle.textContent = '.feathery-table-cell { color: red; }';
    document.head.appendChild(userStyle);

    render(
      <FeatheryCacheProvider>
        <div className='feathery-table-cell' css={{ color: 'blue' }}>
          cell
        </div>
      </FeatheryCacheProvider>
    );

    const insertionPoint = document.head.querySelector(
      'meta[name="feathery-emotion-insertion-point"]'
    );
    expect(insertionPoint).toBeTruthy();

    const featheryStyles = Array.from(
      document.head.querySelectorAll('style[data-emotion^="feathery"]')
    );
    expect(featheryStyles.length).toBeGreaterThan(0);

    // Every feathery emotion tag must precede the user's stylesheet so the
    // user's equal-specificity rules win the cascade by source order
    const headChildren = Array.from(document.head.children);
    const userIdx = headChildren.indexOf(userStyle);
    featheryStyles.forEach((tag) => {
      expect(headChildren.indexOf(tag)).toBeLessThan(userIdx);
    });

    userStyle.remove();
  });
});
