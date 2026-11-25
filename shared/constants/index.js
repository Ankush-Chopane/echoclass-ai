/**
 * EchoClass AI — Shared Constants
 * Shared across classroom-web (React + Vite), public-web (Next.js), and backend (Express).
 */

import GESTURES from '../gestures.js';

export const ROLES = {
  TEACHER: 'teacher',
  STUDENT: 'student'
};

// Who may send which source (enforced by the server): teachers 'speech' | 'typed', students 'sign' | 'student'.
export const CAPTION_SOURCES = {
  SPEECH: 'speech',
  TYPED: 'typed',
  SIGN: 'sign',
  STUDENT: 'student'
};

export const FLAG_KINDS = {
  CONFUSING: 'confusing',
  IMPORTANT: 'important'
};

export const REQUEST_KINDS = {
  RAISE_HAND: 'raise_hand',
  SLOW_DOWN: 'slow_down',
  REPEAT: 'repeat',
  LOUDER: 'louder',
  UNDERSTOOD: 'understood'
};

// [kind, icon, label] in display order
export const REQUEST_BUTTONS = [
  ['raise_hand', '✋', 'Raise hand'],
  ['slow_down', '🐢', 'Slow down'],
  ['repeat', '🔁', 'Please repeat'],
  ['louder', '🔊', 'Speak louder'],
  ['understood', '👍', 'Got it']
];

export const SUPPORTED_LANGUAGES = [
  ['en-IN', 'English (India)'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['hi-IN', 'हिन्दी (Hindi)'],
  ['mr-IN', 'मराठी (Marathi)'],
  ['gu-IN', 'ગુજરાતી (Gujarati)'],
  ['bn-IN', 'বাংলা (Bengali)'],
  ['ta-IN', 'தமிழ் (Tamil)'],
  ['te-IN', 'తెలుగు (Telugu)'],
  ['kn-IN', 'ಕನ್ನಡ (Kannada)'],
  ['ml-IN', 'മലയാളം (Malayalam)'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch']
];

// The gesture list is derived from the recogniser's own registry (gestures.js) so the UI can never advertise a pose the engine cannot detect.
const GESTURE_ICONS = { HELLO: '🖐️', FIST: '✊', THUMBS_UP: '👍', THUMBS_DOWN: '👎', POINT: '☝️', PEACE: '✌️', THREE: '3️⃣', FOUR: '4️⃣', L: '🫵', OK: '👌', HELP: '🤙', ILY: '🤟' };
export const SUPPORTED_GESTURES = Object.entries(GESTURES.DEFAULTS).map(([id, g]) => ({ id, label: g.label, phrase: g.phrase, request: g.request, icon: GESTURE_ICONS[id] || '🖐️' }));

export const ACCESSIBILITY_THEMES = [
  { id: 'dark', label: 'Studio Dark (Default)', bg: '#0b0f19', text: '#f3f4f6' },
  { id: 'light', label: 'Daylight Light', bg: '#f9fafb', text: '#111827' },
  { id: 'high-contrast', label: 'High Contrast (Yellow on Black)', bg: '#000000', text: '#ffff00' },
  { id: 'solarized', label: 'Warm Solarized', bg: '#fdf6e3', text: '#073642' }
];

export const ACCESSIBILITY_FONTS = [
  { id: 'atkinson', label: 'Atkinson Hyperlegible (Low Vision)' },
  { id: 'system', label: 'System Sans-Serif' },
  { id: 'dyslexic', label: 'OpenDyslexic / High Legibility' },
  { id: 'mono', label: 'Monospace (High Clarity)' }
];
