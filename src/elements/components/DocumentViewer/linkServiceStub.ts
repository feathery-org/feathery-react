// Minimal IPDFLinkService stand-in for pdf.js's AnnotationLayer. We render
// form fields for filling/signing, not for interactive link navigation, so
// every method is a safe no-op. Only the members pdf.js 5.4.296's annotation
// layer actually touches are implemented (see AnnotationLayer.render and the
// link/button annotation element classes in pdf.mjs).
export const LINK_SERVICE_STUB = {
  externalLinkEnabled: true,
  eventBus: undefined,
  goToDestination: async () => undefined,
  getDestinationHash: () => '',
  getAnchorUrl: () => '',
  executeNamedAction: () => undefined,
  executeSetOCGState: () => undefined,
  addLinkAttributes: (link: HTMLAnchorElement) => {
    link.href = '';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
};
