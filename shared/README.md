# Shared Package (`@echoclass/shared`)

This package contains shared constants, accessibility definitions, and gesture registries used across:
1. `apps/classroom-web` (React + Vite)
2. `apps/public-web` (Next.js App Router)
3. `apps/backend` (Express API)

## Exports
- `ROLES`: `teacher` and `student`
- `CAPTION_SOURCES`: `speech`, `sign`, `student`
- `FLAG_KINDS`: `confusing`, `important`
- `REQUEST_KINDS`: `slow_down`, `repeat`, `raise_hand`
- `SUPPORTED_LANGUAGES`: 14 recognition languages
- `SUPPORTED_GESTURES`: 10 MediaPipe discrete hand gestures
- `ACCESSIBILITY_THEMES`: High-contrast, dark, light, solarized
- `ACCESSIBILITY_FONTS`: Atkinson Hyperlegible, dyslexic, mono
