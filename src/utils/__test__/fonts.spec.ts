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
      'https://fonts.googleapis.com/css?family=La+Belle+Aurore%7COpen+Sans:400&display=swap'
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
      { family: 'Inter', weight: '100 900', style: 'normal' },
      { family: 'Inter', weight: '100 900', style: 'italic' }
    ]);

    // Act
    loadGoogleFonts(['Inter:400,700,400italic']);

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
    loadGoogleFonts(['Inter:400']);

    // Act
    loadGoogleFonts(['Inter:400']);
    loadGoogleFonts([]);

    // Assert
    expect(getFontLinks()).toHaveLength(1);
  });
});
