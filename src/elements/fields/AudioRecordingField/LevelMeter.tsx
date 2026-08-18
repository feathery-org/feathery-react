import React, { useEffect, useRef } from 'react';
import { featheryWindow } from '../../../utils/browser';

// Scrolling mic-level waveform, painted in `currentColor`. Canvas + rAF
// rather than state, so sampling costs zero re-renders.
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

    const setup = () => {
      const next = Math.max(container.clientWidth, BAR_WIDTH);
      if (next === width) return;
      width = next;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      // Sized in %: a px-wide canvas is an intrinsically-sized flex item and
      // would widen the field while recording
      canvas.style.width = '100%';
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
    let live = 0;
    let frame = 0;
    // Refreshed per tick, not per frame: getComputedStyle forces a recalc
    let color = getComputedStyle(canvas).color;

    const drawBar = (x: number, level: number) => {
      if (x < -BAR_WIDTH || x > width) return;
      const barHeight = Math.max(MIN_BAR_HEIGHT, level * height);
      ctx.fillRect(x, (height - barHeight) / 2, BAR_WIDTH, barHeight);
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const raw = getLevelRef.current();
      peak = Math.max(peak, raw);
      // Eased so the incoming bar blooms rather than popping in
      live += (raw - live) * 0.55;
      if (now - lastSample >= SAMPLE_INTERVAL_MS) {
        lastSample = now;
        color = getComputedStyle(canvas).color;
        // Peak-hold, no decay: speech reads as spiky clusters, not hills
        levels.copyWithin(0, 1);
        levels[barCount - 1] =
          peak < SILENCE_THRESHOLD ? 0 : Math.min(1, Math.sqrt(peak));
        peak = 0;
      }
      // Slide the strip a fraction of a slot between samples so it glides at
      // frame rate; the live bar lands on the newest slot as its value freezes
      const offset =
        Math.min(1, (now - lastSample) / SAMPLE_INTERVAL_MS) * pitch;
      const liveX = width - BAR_WIDTH + (pitch - offset);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      drawBar(
        liveX,
        live < SILENCE_THRESHOLD ? 0 : Math.min(1, Math.sqrt(live))
      );
      for (let i = 0; i < barCount; i++) {
        drawBar(liveX - (barCount - i) * pitch, levels[i]);
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
      css={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center'
      }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} css={{ display: 'block' }} />
    </div>
  );
}

export default LevelMeter;
