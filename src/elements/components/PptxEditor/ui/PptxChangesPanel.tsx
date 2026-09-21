import React, { useMemo, useState } from 'react';
import {
  ADD_WASH,
  CARD_SHADOW,
  DEL,
  INK,
  INK_2,
  INK_3,
  LINE,
  PAPER,
  btn,
  rejectBtn
} from '../../DocxEditor/TrackedChangeGroups/styles';
import {
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import type { PptxChangeRecord } from '../engine/changes';

// Tracked-edits panel: the engine's transaction log grouped by slide, newest
// first. Clicking a record selects its shape; pending assistant suggestions
// offer accept/reject (reject refuses to overwrite conflicting later work).

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function RecordCard({
  record,
  slideIndex,
  onSelect,
  onAccept,
  onReject,
  conflict
}: {
  record: PptxChangeRecord;
  slideIndex: number;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  conflict?: string;
}) {
  const pending = record.status === 'pending';
  return (
    <div
      css={{
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        background: pending ? ADD_WASH : PAPER,
        boxShadow: CARD_SHADOW,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <button
        type='button'
        onClick={onSelect}
        css={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'baseline',
          gap: 6
        }}
      >
        <span css={{ fontSize: 12.5, fontWeight: 600, color: INK, flex: 1 }}>
          {record.summary}
        </span>
        <span css={{ fontSize: 10.5, color: INK_3, flex: '0 0 auto' }}>
          {timeLabel(record.createdAt)}
        </span>
      </button>
      <span css={{ fontSize: 11, color: INK_2 }}>
        Slide {slideIndex + 1} · {record.author.label}
        {record.status === 'rejected' && (
          <span css={{ color: DEL }}> · rejected</span>
        )}
      </span>
      {pending && (
        <div css={{ display: 'flex', gap: 6 }}>
          <button type='button' css={btn} onClick={onAccept}>
            Accept
          </button>
          <button type='button' css={rejectBtn} onClick={onReject}>
            Reject
          </button>
        </div>
      )}
      {conflict && <span css={{ fontSize: 11, color: DEL }}>{conflict}</span>}
    </div>
  );
}

export default function PptxChangesPanel() {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const [conflicts, setConflicts] = useState<Record<string, string>>({});

  const records = store.engine.changes();
  const groups = useMemo(() => {
    const deck = state.deck;
    if (!deck) return [];
    const bySlide = new Map<number, PptxChangeRecord[]>();
    for (const record of records) {
      const slidePath = record.targets[0]?.slideId;
      const index = Math.max(
        0,
        deck.slides.findIndex((slide) => slide.path === slidePath)
      );
      const list = bySlide.get(index) ?? [];
      list.push(record);
      bySlide.set(index, list);
    }
    return [...bySlide.entries()].sort(([a], [b]) => a - b);
    // records identity changes with every engine commit; rev tracks it
    // eslint-disable-next-line
  }, [state.deck, state.rev, records]);

  const selectRecord = (record: PptxChangeRecord) => {
    const deck = state.deck;
    const target = record.targets[0];
    if (!deck || !target) return;
    const index = deck.slides.findIndex(
      (slide) => slide.path === target.slideId
    );
    if (index >= 0 && index !== state.activeSlide) store.setActiveSlide(index);
    if (target.shapeId) store.select(target.shapeId);
  };

  const reject = (record: PptxChangeRecord) => {
    const outcome = store.rejectChange(record.id);
    if (!outcome.ok) {
      setConflicts((current) => ({
        ...current,
        [record.id]:
          outcome.reason === 'conflict'
            ? 'The affected content changed since this suggestion; resolve it manually.'
            : outcome.reason === 'unsupported'
            ? 'This suggestion cannot be auto-reverted; adjust the slide manually.'
            : 'This suggestion is no longer pending.'
      }));
    }
  };

  if (!records.length) {
    return (
      <div css={{ padding: 16, color: INK_3, fontSize: 13, width: '100%' }}>
        Edits you make will be tracked here.
      </div>
    );
  }

  return (
    <div
      css={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12
      }}
    >
      {groups.map(([slideIndex, slideRecords]) => (
        <div
          key={slideIndex}
          css={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <span
            css={{
              fontSize: 11,
              fontWeight: 700,
              color: INK_3,
              textTransform: 'uppercase',
              letterSpacing: 0.4
            }}
          >
            Slide {slideIndex + 1}
          </span>
          {slideRecords
            .slice()
            .reverse()
            .map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                slideIndex={slideIndex}
                onSelect={() => selectRecord(record)}
                onAccept={() => store.acceptChange(record.id)}
                onReject={() => reject(record)}
                conflict={conflicts[record.id]}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
