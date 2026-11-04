/* eslint-disable no-restricted-globals -- Browser-only test entry, never used by SSR. */
import { importDeck } from '../../core/model/import';
import { exportDeckBytes } from '../../core/model/export';
import { renderSlideSvg, reconcileSlideSvg } from '../../core/render/svg';
import { ensureDeckFontsLoaded, cssFamilyList } from '../../core/render/fonts';
import { releaseEmbeddedFonts } from '../../core/render/embeddedFonts';
import type { Deck } from '../../core/model/types';

let deck: Deck;

// Real import -> EOT decode -> FontFace -> SVG. No FontFace/canvas mocks.
(window as any).pptxFonts = {
  async open(base64: string, roundTrip = false) {
    if (deck) releaseEmbeddedFonts(deck.pkg);
    deck = importDeck(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    if (roundTrip) deck = importDeck(exportDeckBytes(deck));
    await ensureDeckFontsLoaded(deck);
    await document.fonts.ready;
    const faces: any[] = [];
    document.fonts.forEach((face) =>
      faces.push({
        family: face.family,
        weight: face.weight,
        style: face.style,
        status: face.status
      })
    );
    return { slides: deck.slides.length, faces };
  },
  async slide(number: number, canvasWidth = 1280) {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.style.width = `${canvasWidth}px`;
    host.appendChild(renderSlideSvg(deck, deck.slides[number - 1]));
    document.body.appendChild(host);
    await document.fonts.ready;
    return Array.from(host.querySelectorAll<HTMLElement>('[data-source-run]'))
      .filter((node) => node.textContent?.trim())
      .map((node, index) => {
        node.id = `run-${index}`;
        const style = getComputedStyle(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          id: node.id,
          text: node.textContent,
          family: style.fontFamily,
          weight: style.fontWeight,
          style: style.fontStyle,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          rects: Array.from(range.getClientRects()).map((r) => ({
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height
          }))
        };
      });
  },
  refresh(number: number) {
    const svg = document.querySelector('svg');
    if (!svg) throw new Error('Render a slide before refreshing');
    reconcileSlideSvg(deck, deck.slides[number - 1], svg, {
      fullContent: true,
      structure: true,
      background: true
    });
  },
  async probe(family: string, weight: number, italic: boolean) {
    const node = document.createElement('span');
    node.id = 'probe';
    node.textContent = 'Hamburgefonts 0123456789';
    node.style.fontFamily = cssFamilyList(family, deck);
    node.style.fontSize = '32px';
    node.style.fontWeight = String(weight);
    node.style.fontStyle = italic ? 'italic' : 'normal';
    document.body.replaceChildren(node);
    await document.fonts.ready;
    // Force layout before CDP asks which faces supplied the rendered glyphs.
    return node.getBoundingClientRect().width;
  },
  release() {
    releaseEmbeddedFonts(deck.pkg);
  },
  async pixelDifference(a: string, b: string) {
    async function pixels(s: string) {
      const im = new Image();
      im.src = 'data:image/png;base64,' + s;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(im, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    }
    const [x, y] = await Promise.all([pixels(a), pixels(b)]);
    let diff = 0;
    for (let i = 0; i < x.length; i += 4)
      diff +=
        Math.abs(x[i] - y[i]) +
        Math.abs(x[i + 1] - y[i + 1]) +
        Math.abs(x[i + 2] - y[i + 2]);
    return diff / ((x.length / 4) * 3 * 255);
  },
  async inkRows(base64: string, color: string) {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable in the real browser');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    const rows: number[] = [];
    for (let y = 0; y < image.height; y++) {
      let ink = 0;
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const lo = Math.min(r, g, b) / 255;
        const hi = Math.max(r, g, b) / 255;
        ink +=
          color === 'blue'
            ? b > 100
              ? Math.max(0, (b - r) / 255)
              : 0
            : color === 'green'
            ? g > 140
              ? Math.max(0, (g - r) / 255)
              : 0
            : lo > 0.18 && hi - lo < 0.15
            ? (lo - 0.12) / 0.88
            : 0;
      }
      rows.push(ink);
    }
    return rows;
  }
};
