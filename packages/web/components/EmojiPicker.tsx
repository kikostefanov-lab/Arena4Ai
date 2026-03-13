'use client';
import { getModelColor } from '../lib/design-tokens';

const EMOJI_OPTIONS = [
  '🤖', '🏗️', '⚡', '🔧', '🔬', '⚔️', '🛡️', '🚀', '💻', '✨',
  '🎯', '🦾', '🧠', '🔥', '💡', '🌊', '⚙️', '🎲', '🔮', '🦊',
  '🐉', '👾', '🛸', '🌀', '💎', '🎭', '🌟', '🔑', '⚗️', '🧪',
];

interface EmojiPickerProps {
  value?: string;
  provider?: string;
  onChange: (emoji: string) => void;
}

export function EmojiPicker({ value, provider, onChange }: EmojiPickerProps) {
  const accentColor = provider ? getModelColor(provider) : '#00f0ff';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(10, 1fr)',
      gap: '0.3rem',
      padding: '0.6rem',
      background: 'rgba(0,4,8,0.8)',
      borderRadius: '8px',
      border: '1px solid rgba(0,240,255,0.1)',
    }}>
      {EMOJI_OPTIONS.map(emoji => (
        <button
          key={emoji}
          type="button"
          onClick={() => onChange(emoji)}
          style={{
            width: '2rem',
            height: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            borderRadius: '4px',
            border: value === emoji ? `1.5px solid ${accentColor}` : '1.5px solid transparent',
            background: value === emoji ? `${accentColor}18` : 'transparent',
            cursor: 'pointer',
            transition: 'border-color 0.1s, background 0.1s',
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
