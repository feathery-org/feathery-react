import { snapMove, SNAP_TOLERANCE } from '../ui/snap';

const box = { left: 100, top: 100, width: 40, height: 20 };

describe('snapMove', () => {
  it('leaves the delta untouched when nothing is near', () => {
    const r = snapMove(box, 50, 30, [500], [500]);
    expect(r.dx).toBe(50);
    expect(r.dy).toBe(30);
    expect(r.guides).toEqual([]);
  });

  it('snaps the left edge onto a nearby vertical line and emits a guide', () => {
    // moving right by 8 puts left at 108; a line at 110 is 2px away → snap
    const r = snapMove(box, 8, 0, [110], []);
    expect(r.dx).toBe(10); // 108 + 2 → left lands on 110
    expect(r.guides).toEqual([{ x: 110 }]);
  });

  it('ignores a line just outside the tolerance', () => {
    const r = snapMove(box, 8, 0, [100 + 8 + SNAP_TOLERANCE + 1], []);
    expect(r.dx).toBe(8);
    expect(r.guides).toEqual([]);
  });

  it('snaps the center edge, not just the left', () => {
    // center starts at 120; move +3 → 123; line at 122 is 1px away → snap center to 122
    const r = snapMove(box, 3, 0, [122], []);
    expect(r.dx).toBe(2); // 123 - 1
    expect(r.guides).toEqual([{ x: 122 }]);
  });

  it('picks the nearest candidate when several are in range', () => {
    // left at 105 after +5; lines at 104 (1 away) and 107 (2 away) → choose 104
    const r = snapMove(box, 5, 0, [104, 107], []);
    expect(r.dx).toBe(4);
    expect(r.guides).toEqual([{ x: 104 }]);
  });

  it('snaps both axes at once', () => {
    const r = snapMove(box, 8, 8, [110], [110]);
    expect(r.dx).toBe(10);
    expect(r.dy).toBe(10);
    expect(r.guides).toEqual([{ x: 110 }, { y: 110 }]);
  });
});
