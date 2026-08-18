import { loadGoogleFonts } from '../fonts';
import { featheryDoc } from '../browser';

const getFontLinks = () =>
  Array.from(
    featheryDoc().head.querySelectorAll(
      'link[href*="fonts.googleapis.com"]'
    ) as NodeListOf<HTMLLinkElement>
  );

describe('loadGoogleFonts', () => {
  afterEach(() => {
    getFontLinks().forEach((link) => link.remove());
  });

  it('requests display=swap so text is never blanked during download', () => {
    // Arrange
    const families = ['Inter:400,400italic,700'];

    // Act
    loadGoogleFonts(families);

    // Assert
    const [link] = getFontLinks();
    expect(link.rel).toEqual('stylesheet');
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Inter:400,400italic,700&display=swap'
    );
  });

  it('encodes multi-word families and joins multiple families', () => {
    // Arrange
    const families = ['La Belle Aurore', 'Open Sans:400'];

    // Act
    loadGoogleFonts(families);

    // Assert
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=La+Belle+Aurore:400%7COpen+Sans:400&display=swap'
    );
  });

  it('retries a family on a later call if its stylesheet failed to load', () => {
    // Arrange
    loadGoogleFonts(['Lato:400']);
    const [link] = getFontLinks();

    // Act — transient network failure on the stylesheet request
    link.dispatchEvent(new Event('error'));
    loadGoogleFonts(['Lato:400']);

    // Assert — failed link removed, fresh request issued
    expect(getFontLinks()).toHaveLength(1);
    expect(getFontLinks()[0]).not.toBe(link);
  });

  it('requests only the variants the host page has not declared', () => {
    // Arrange — jsdom has no document.fonts; stub with a Set of fake
    // FontFaces (CSS-declared families can come back quoted)
    (featheryDoc() as any).fonts = new Set([
      { family: '"Roboto"', weight: '400', style: 'normal' }
    ]);

    // Act
    loadGoogleFonts(['Roboto:400,700,400italic', 'Lora:400']);

    // Assert — Roboto 400 is covered; 700 + 400italic still needed
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Roboto:700,400italic%7CLora:400&display=swap'
    );
    delete (featheryDoc() as any).fonts;
  });

  it('skips a family fully covered by a host variable font', () => {
    // Arrange — variable fonts declare a weight range
    (featheryDoc() as any).fonts = new Set([
      { family: 'Karla', weight: '100 900', style: 'normal' },
      { family: 'Karla', weight: '100 900', style: 'italic' }
    ]);

    // Act
    loadGoogleFonts(['Karla:400,700,400italic']);

    // Assert
    expect(getFontLinks()).toHaveLength(0);
    delete (featheryDoc() as any).fonts;
  });

  it('does not treat a host italic face as covering the normal style', () => {
    // Arrange
    (featheryDoc() as any).fonts = new Set([
      { family: 'Lato', weight: 'bold', style: 'italic' }
    ]);

    // Act
    loadGoogleFonts(['Lato:700']);

    // Assert — 700 normal is not covered by 700 italic
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Lato:700&display=swap'
    );
    delete (featheryDoc() as any).fonts;
  });

  it('does not re-request a family it already loaded', () => {
    // Arrange
    loadGoogleFonts(['Rubik:400']);

    // Act
    loadGoogleFonts(['Rubik:400']);
    loadGoogleFonts([]);

    // Assert
    expect(getFontLinks()).toHaveLength(1);
  });

  it('does not treat a host face whose download failed as coverage', () => {
    // Arrange — errored faces stay in document.fonts but never render
    (featheryDoc() as any).fonts = new Set([
      { family: 'Bitter', weight: '400', style: 'normal', status: 'error' }
    ]);

    // Act
    loadGoogleFonts(['Bitter:400']);

    // Assert — the broken host declaration must not suppress our own load
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Bitter:400&display=swap'
    );
    delete (featheryDoc() as any).fonts;
  });

  it('treats a host oblique face as covering an italic request', () => {
    // Arrange
    (featheryDoc() as any).fonts = new Set([
      { family: 'Cabin', weight: '400', style: 'oblique 10deg' }
    ]);

    // Act
    loadGoogleFonts(['Cabin:400italic']);

    // Assert
    expect(getFontLinks()).toHaveLength(0);
    delete (featheryDoc() as any).fonts;
  });

  it('parses keyword variants like regular and italic', () => {
    // Arrange
    (featheryDoc() as any).fonts = new Set([
      { family: 'Arvo', weight: '400', style: 'normal' }
    ]);

    // Act — 'regular' is 400 normal (covered); 'italic' is 400 italic
    loadGoogleFonts(['Arvo:regular,italic']);

    // Assert
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Arvo:italic&display=swap'
    );
    delete (featheryDoc() as any).fonts;
  });

  it('covers the inclusive boundaries of a variable-font weight range', () => {
    // Arrange
    (featheryDoc() as any).fonts = new Set([
      { family: 'Sora', weight: '100 900', style: 'normal' }
    ]);

    // Act
    loadGoogleFonts(['Sora:100,900']);

    // Assert
    expect(getFontLinks()).toHaveLength(0);
    delete (featheryDoc() as any).fonts;
  });

  it('re-requests a host-covered variant after the host declaration is removed', () => {
    // Arrange — host declares the font, e.g. via a route-scoped stylesheet
    (featheryDoc() as any).fonts = new Set([
      { family: 'Merriweather', weight: '400', style: 'normal' }
    ]);
    loadGoogleFonts(['Merriweather:400']);
    expect(getFontLinks()).toHaveLength(0);

    // Act — SPA route/theme change drops the declaration, form loads again
    (featheryDoc() as any).fonts = new Set();
    loadGoogleFonts(['Merriweather:400']);

    // Assert — the skip was not cached; the variant is now requested
    const [link] = getFontLinks();
    expect(link.href).toEqual(
      'https://fonts.googleapis.com/css?family=Merriweather:400&display=swap'
    );
    delete (featheryDoc() as any).fonts;
  });
});
