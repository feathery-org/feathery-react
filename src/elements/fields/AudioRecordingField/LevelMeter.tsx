import React, { useEffect, useRef } from 'react';
import { featheryWindow } from '../../../utils/browser';

// Scrolling mic-level waveform: the newest sample enters at the right and
// history slides left, so a respondent can see their voice registering.
// Canvas + rAF rather than state, so ~9 samples/sec cost zero re-renders.
// Paints in `currentColor` so the parent controls the color.
const BAR_WIDTH = 2;
const BAR_GAP = 3;
const SAMPLE_INTERVAL_MS = 110;
// Silence reads as a fine dotted line instead of a flat gap
const MIN_BAR_HEIGHT = 2;
const SILENCE_THRESHOLD = 0.07;

function LevelMeter({
  getLevel,
  height = 22
}: {
  getLevel: () => number;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!container || !canvas || !ctx) return;

    const dpr = featheryWindow().devicePixelRatio || 1;
    const pitch = BAR_WIDTH + BAR_GAP;
    let width = 0;
    let barCount = 1;
    let levels = new Float32Array(1);

    // The field can be resized in the builder, so track the container width
    const setup = () => {
      const next = Math.max(container.clientWidth, BAR_WIDTH);
      if (next === width) return;
      width = next;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(1, Math.floor(width / pitch));
      const grown = new Float32Array(count);
      const keep = Math.min(count, barCount);
      grown.set(levels.subarray(barCount - keep), count - keep);
      levels = grown;
      barCount = count;
    };
    setup();
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(setup) : null;
    observer?.observe(container);

    let lastSample = 0;
    let peak = 0;
    let frame = 0;
    // Refreshed per sample tick, not per frame: getComputedStyle forces a
    // style recalc, and the parent's color rarely changes
    let color = getComputedStyle(canvas).color;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      peak = Math.max(peak, getLevelRef.current());
      if (now - lastSample >= SAMPLE_INTERVAL_MS) {
        lastSample = now;
        color = getComputedStyle(canvas).color;
        // Peak-hold with no decay envelope, so speech reads as spiky
        // clusters rather than smooth hills
        levels.copyWithin(0, 1);
        levels[barCount - 1] =
          peak < SILENCE_THRESHOLD ? 0 : Math.min(1, Math.sqrt(peak));
        peak = 0;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      for (let i = 0; i < barCount; i++) {
        const barHeight = Math.max(MIN_BAR_HEIGHT, levels[i] * height);
        ctx.fillRect(i * pitch, (height - barHeight) / 2, BAR_WIDTH, barHeight);
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [height]);

  return (
    <div
      ref={containerRef}
      css={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} css={{ display: 'block' }} />
    </div>
  );
}

export default LevelMeter;
