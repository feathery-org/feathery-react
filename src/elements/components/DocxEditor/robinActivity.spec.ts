import {
  isAssistantApplyingEdits,
  isAssistantWriting,
  setAssistantSessionActive
} from '../../../assistant/tools/docx/syncfusionDocumentOps';
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

  // until the assistant's operations path is retired, both writers mark the same editor
  it('honours the assistant operations path and is honoured by it', () => {
    const editor: any = {};
    const heard: boolean[] = [];
    onRobinTurnChange(editor, (a) => heard.push(a));
    setAssistantSessionActive(editor, true);
    expect(isRobinEditing(editor)).toBe(true);
    expect(heard).toEqual([true]);
    setAssistantSessionActive(editor, false);
    setRobinTurnActive(editor, true);
    expect(isAssistantWriting(editor)).toBe(true);
    whileRobinWrites(editor, () => {
      expect(isAssistantApplyingEdits(editor)).toBe(true);
    });
    expect(isAssistantApplyingEdits(editor)).toBe(false);
  });
});
