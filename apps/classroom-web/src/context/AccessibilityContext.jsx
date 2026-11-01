import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';

export const AccessibilityContext = createContext(null);

export function AccessibilityProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('echoclass_theme') || 'dark');
  const [captionSize, setCaptionSize] = useState(() => Number(localStorage.getItem('echoclass_caption_size')) || 28);
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('echoclass_font') || 'atkinson');
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    // Apply theme to body
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-high-contrast', 'theme-solarized');
    if (theme !== 'dark') {
      document.body.classList.add(`theme-${theme}`);
    }
    localStorage.setItem('echoclass_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--caption-size', `${captionSize}px`);
    localStorage.setItem('echoclass_caption_size', String(captionSize));
  }, [captionSize]);

  useEffect(() => {
    localStorage.setItem('echoclass_font', fontFamily);
  }, [fontFamily]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme,
    captionSize,
    setCaptionSize,
    fontFamily,
    setFontFamily,
    focusMode,
    toggleFocusMode
  }), [theme, captionSize, fontFamily, focusMode, toggleFocusMode]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}
