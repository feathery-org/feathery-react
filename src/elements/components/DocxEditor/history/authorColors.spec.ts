import {
  ASSISTANT_COLOR,
  AUTHOR_PALETTE,
  CURRENT_USER_COLOR,
  colorForAuthor,
  colorForRevisionAuthor,
  firstUserActorKey,
  initialsForAuthor
} from './authorColors';

describe('colorForAuthor', () => {
  it('always paints Robin the Feathery red', () => {
    expect(colorForAuthor({ kind: 'assistant', label: 'Robin' })).toBe(
      ASSISTANT_COLOR
    );
  });

  it('always paints the current viewer orange', () => {
    expect(colorForAuthor({ kind: 'user', key: 'you' })).toBe(
      CURRENT_USER_COLOR
    );
    expect(colorForAuthor({ kind: 'user', label: 'You' })).toBe(
      CURRENT_USER_COLOR
    );
    expect(colorForAuthor({ kind: 'user', label: '' })).toBe(
      CURRENT_USER_COLOR
    );
  });

  it('gives other people a stable palette colour, never orange or red', () => {
    const a = colorForAuthor({ kind: 'user', label: 'sam@co.com' });
    const b = colorForAuthor({ kind: 'user', label: 'sam@co.com' });
    expect(a).toBe(b); // stable
    expect(AUTHOR_PALETTE).toContain(a);
    expect(a).not.toBe(CURRENT_USER_COLOR);
    expect(a).not.toBe(ASSISTANT_COLOR);
  });

  it('separates two different people', () => {
    // Not guaranteed distinct in general, but these two land on different hues.
    const a = colorForAuthor({ kind: 'user', label: 'alice@co.com' });
    const b = colorForAuthor({ kind: 'user', label: 'bob@co.com' });
    expect(a).not.toBe(b);
  });
});

describe('colorForRevisionAuthor', () => {
  it('maps a revision author key to the matching brand colour', () => {
    expect(colorForRevisionAuthor('you')).toBe(CURRENT_USER_COLOR);
    expect(colorForRevisionAuthor('robin')).toBe(ASSISTANT_COLOR);
  });

  it('ignores the fmt: prefix on a formatting-change author', () => {
    expect(colorForRevisionAuthor('fmt:you')).toBe(CURRENT_USER_COLOR);
    expect(colorForRevisionAuthor('fmt:robin')).toBe(ASSISTANT_COLOR);
  });

  it('gives a named human a stable palette colour', () => {
    const a = colorForRevisionAuthor('sam@co.com');
    expect(a).toBe(colorForRevisionAuthor('sam@co.com'));
    expect(AUTHOR_PALETTE).toContain(a);
  });

  it('uses a stored version actor for the browser author key', () => {
    const actor = 'sam@co.com';
    const avatarColor = colorForAuthor({
      kind: 'user',
      key: actor,
      label: actor
    });
    const revisionColor = colorForRevisionAuthor('you', actor);
    expect(revisionColor).toBe(avatarColor);
    expect(colorForRevisionAuthor('fmt:you', actor)).toBe(avatarColor);
    expect(colorForRevisionAuthor('robin', actor)).toBe(ASSISTANT_COLOR);
  });

  it('uses the earlier orange for the first human editor in every version', () => {
    const first = 'first@co.com';
    const later = 'later@co.com';
    const key = firstUserActorKey([
      { seq: 2, authors: [{ kind: 'user' }], actor_label: later },
      { seq: 0, authors: [] },
      { seq: 1, authors: [{ kind: 'user' }], actor_label: first }
    ]);
    expect(key).toBe(first);
    expect(colorForAuthor({ kind: 'user', key: first }, key)).toBe(
      CURRENT_USER_COLOR
    );
    expect(colorForRevisionAuthor('you', first, key)).toBe(CURRENT_USER_COLOR);
    expect(colorForAuthor({ kind: 'user', key: later }, key)).not.toBe(
      CURRENT_USER_COLOR
    );
    expect(colorForRevisionAuthor('you', later, key)).toBe(
      colorForAuthor({ kind: 'user', key: later }, key)
    );
  });
});

describe('initialsForAuthor', () => {
  it('derives initials from an email or name, defaulting to Y for the viewer', () => {
    expect(initialsForAuthor({ kind: 'user', label: 'You' })).toBe('Y');
    expect(initialsForAuthor({ kind: 'user', label: '' })).toBe('Y');
    expect(initialsForAuthor({ kind: 'user', label: 'sam.lee@co.com' })).toBe(
      'SL'
    );
    expect(initialsForAuthor({ kind: 'user', label: 'sam@co.com' })).toBe('SC');
  });
});
