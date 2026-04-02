import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../../utils/browser';
import { stringifyWithNull } from '../../../utils/primitives';
import { DeleteConfirm } from './DeleteConfirm';
import {
  clickToEditStyle,
  cellInputStyle,
  overflowIconStyle,
  editableCellContentStyle,
  editableCellTextStyle,
  editingCellContentStyle,
  editingCellInputStyle,
  editingCellSizerStyle,
  actionMenuStyle,
  actionMenuItemStyle
} from './styles';

type EditableCellProps = {
  value: any;
  fieldKey: string;
  rowIndex: number;
  onEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  onClear: (fieldKey: string, rowIndex: number) => void;
};

function OverflowIcon() {
  return (
    <svg width='16' height='16' fill='currentColor' viewBox='0 0 24 24'>
      <circle cx='12' cy='5' r='2' />
      <circle cx='12' cy='12' r='2' />
      <circle cx='12' cy='19' r='2' />
    </svg>
  );
}

export function EditableCell({
  value,
  fieldKey,
  rowIndex,
  onEdit,
  onClear
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shouldSaveRef = useRef(true);

  const closeClearConfirm = useCallback(() => setShowClearConfirm(false), []);

  const displayValue = stringifyWithNull(value) ?? '';
  const isEmpty = displayValue === '';

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    const handleScroll = () => setIsMenuOpen(false);

    const doc = featheryDoc();
    doc.addEventListener('mousedown', handleClickOutside);
    doc.addEventListener('scroll', handleScroll, true);

    return () => {
      doc.removeEventListener('mousedown', handleClickOutside);
      doc.removeEventListener('scroll', handleScroll, true);
    };
  }, [isMenuOpen]);

  const startEditing = () => {
    setEditValue(displayValue);
    setIsEditing(true);
    setIsMenuOpen(false);
  };

  const saveEdit = () => {
    if (editValue !== displayValue) {
      onEdit(fieldKey, rowIndex, editValue);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    shouldSaveRef.current = false;
    setIsEditing(false);
  };

  const handleBlur = () => {
    if (shouldSaveRef.current) saveEdit();
    shouldSaveRef.current = true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      shouldSaveRef.current = false;
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Tab') {
      shouldSaveRef.current = false;
      saveEdit();
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isMenuOpen && menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 4, left: rect.right });
    }
    setIsMenuOpen(!isMenuOpen);
  };

  if (isEditing) {
    return (
      <div css={editingCellContentStyle}>
        <div css={editingCellSizerStyle}>{`${editValue}\u200b`}</div>
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          css={{ ...cellInputStyle, ...editingCellInputStyle }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <span css={clickToEditStyle} onClick={startEditing}>
        Click to edit
      </span>
    );
  }

  return (
    <div css={editableCellContentStyle}>
      <span css={editableCellTextStyle}>{displayValue}</span>
      <button
        ref={menuButtonRef}
        type='button'
        aria-expanded={isMenuOpen}
        aria-haspopup='menu'
        css={overflowIconStyle}
        onClick={handleMenuToggle}
      >
        <OverflowIcon />
      </button>
      {isMenuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role='menu'
            css={{
              ...actionMenuStyle,
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              transform: 'translateX(-100%)'
            }}
          >
            <button
              type='button'
              role='menuitem'
              css={actionMenuItemStyle}
              onClick={(e) => {
                e.stopPropagation();
                startEditing();
              }}
            >
              Edit Value
            </button>
            <button
              type='button'
              role='menuitem'
              css={actionMenuItemStyle}
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                setShowClearConfirm(true);
              }}
            >
              Clear Field
            </button>
          </div>,
          featheryDoc().body
        )}
      {showClearConfirm && (
        <DeleteConfirm
          anchorEl={menuButtonRef.current}
          message='Clear this field?'
          confirmLabel='Clear'
          onConfirm={() => {
            closeClearConfirm();
            onClear(fieldKey, rowIndex);
          }}
          onCancel={closeClearConfirm}
        />
      )}
    </div>
  );
}
