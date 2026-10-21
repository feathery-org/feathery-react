import {
  isRobinEditing,
  isRobinWriting,
  onRobinTurnChange,
  setRobinTurnActive,
  whileRobinWrites
} from './robinActivity';

describe('robinActivity', () => {
  it('marks the editor as Robin writing only while the write runs', () => {
    const editor = {};
    let during = false;
    whileRobinWrites(editor, () => {
      during = isRobinWriting(editor);
    });
    expect(during).toBe(true);
    expect(isRobinWriting(editor)).toBe(false);
  });

  it('puts the previous mark back, even when the write throws', () => {
    const editor = {};
    whileRobinWrites(editor, () => {
      expect(() =>
        whileRobinWrites(editor, () => {
          throw new Error('x');
        })
      ).toThrow('x');
      expect(isRobinWriting(editor)).toBe(true);
    });
    expect(isRobinWriting(editor)).toBe(false);
  });

  it('delivers turn edges only', () => {
    const editor = {};
    const heard: boolean[] = [];
    const off = onRobinTurnChange(editor, (a) => heard.push(a));
    setRobinTurnActive(editor, true);
    setRobinTurnActive(editor, true);
    setRobinTurnActive(editor, false);
    off();
    setRobinTurnActive(editor, true);
    expect(heard).toEqual([true, false]);
    expect(isRobinEditing(editor)).toBe(true);
  });
});
