import React, { createContext, useContext, useMemo } from 'react';
import BaseElements from '../src/elements';
import { DEFAULT_MOBILE_BREAKPOINT } from '../src/elements/styles';
import { StyledContainer } from '../src/Form/grid/StyledContainer';
import { calculateGlobalCSS } from '../src/utils/hydration';
import { FeatheryCacheProvider } from '../src/utils/emotionCache';

// A hosted form styles an element in three layers, each on its own box:
//   <form>             global styles (calculateGlobalCSS -> 'form' target)
//   StyledContainer    the element's container target: width, padding, margin
//   element            its own targets, with mobile_styles under a breakpoint
// Rendering an element bare skips the outer two and, with componentOnly left
// at its default, drops mobile_styles entirely. FormFrame and StoryElements put
// the layers back so a story renders the way Form/grid does.

type Styles = Record<string, any>;

interface FrameSettings {
  globalStyles: Styles;
  mobileBreakpoint: number;
}

const FrameContext = createContext<FrameSettings>({
  globalStyles: {},
  mobileBreakpoint: DEFAULT_MOBILE_BREAKPOINT
});

/** Stands in for Form's <form>: global styles sit above every element */
export function FormFrame({
  globalStyles = {},
  mobileBreakpoint = DEFAULT_MOBILE_BREAKPOINT,
  children
}: Partial<FrameSettings> & { children: React.ReactNode }) {
  const globalCSS = useMemo(
    () => calculateGlobalCSS(globalStyles),
    [globalStyles]
  );
  const settings = useMemo(
    () => ({ globalStyles, mobileBreakpoint }),
    [globalStyles, mobileBreakpoint]
  );
  return (
    <FrameContext.Provider value={settings}>
      <FeatheryCacheProvider>
        <form
          className='feathery'
          onSubmit={(e) => e.preventDefault()}
          css={globalCSS.getTarget('form')}
        >
          {children}
        </form>
      </FeatheryCacheProvider>
    </FrameContext.Provider>
  );
}

const frameElement = (Element: any) => {
  const Framed = ({ element, ...props }: any) => {
    const { mobileBreakpoint } = useContext(FrameContext);
    // Stable across renders so the memoized element doesn't rebuild its styles
    const formSettings = useMemo(
      () => ({ mobileBreakpoint }),
      [mobileBreakpoint]
    );
    const node = useMemo(() => ({ ...element, isElement: true }), [element]);
    return (
      <StyledContainer node={node} breakpoint={mobileBreakpoint}>
        <Element
          element={element}
          componentOnly={false}
          formSettings={formSettings}
          {...props}
        />
      </StyledContainer>
    );
  };
  Framed.displayName = `Framed(${Element.displayName ?? 'Element'})`;
  return Framed;
};

/**
 * Drop-in for src/elements' default export. Stories render through this so
 * every element gets its container and mobile styles the way a form does.
 */
const StoryElements = Object.fromEntries(
  Object.entries(BaseElements).map(([key, Element]) => [
    key,
    frameElement(Element)
  ])
) as Record<keyof typeof BaseElements, React.ComponentType<any>>;

export default StoryElements;
