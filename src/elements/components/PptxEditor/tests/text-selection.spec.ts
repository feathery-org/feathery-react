/* eslint-disable no-restricted-globals -- jsdom-only test of DOM selection */
import { selectedTextRanges } from '../ui/textSelection';

it('maps a selected word across DOM spans to text offsets without counting the bullet', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div><span data-bullet contenteditable="false">• </span><span>Hello </span><span>world</span></div>';
  document.body.appendChild(root);
  const first = root.querySelectorAll('span')[1].firstChild!;
  const last = root.querySelectorAll('span')[2].firstChild!;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(first, 5);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selectedTextRanges(root, selection)).toEqual([
    { paragraph: 0, start: 0, end: 5 }
  ]);

  range.setStart(first, 3);
  range.setEnd(last, 5);
  expect(selectedTextRanges(root, selection)).toEqual([
    { paragraph: 0, start: 3, end: 11 }
  ]);
  selection.removeAllRanges();
  root.remove();
});

it('counts a soft break when locating selected text on the following line', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div><span>Hello</span><br data-soft-break><span>world</span></div>';
  document.body.appendChild(root);
  const word = root.querySelectorAll('span')[1].firstChild!;
  const range = document.createRange();
  range.setStart(word, 0);
  range.setEnd(word, 5);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selectedTextRanges(root, selection)).toEqual([
    { paragraph: 0, start: 6, end: 11 }
  ]);
  selection.removeAllRanges();
  root.remove();
});
