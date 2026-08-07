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
