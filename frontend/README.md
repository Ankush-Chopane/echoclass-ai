# Classroom Web (`@echoclass/classroom-web`)

## React + Vite Interactive Classroom Application

This application serves as the primary interactive client for teachers and students in EchoClass AI, demonstrating the curriculum topics of **INT252: Web App Development with ReactJS**.

---

## 1. Architecture & Technology Stack

- **Framework**: React 18 + Vite (fast HMR, ES module bundling)
- **Routing**: `react-router-dom` (v6) with declarative `Route`, `Navigate`, and route guard wrappers (`ProtectedRoute`, `PublicOnlyRoute`)
- **State Management**:
  - Global Session & Auth State: React Context (`AuthContext` via `useAuth`)
  - Global Accessibility & Themes: React Context (`AccessibilityContext` via `useAccessibility`)
  - Server State & Real-Time Sync: Custom WebSocket and REST hook (`useWebSocket`)
- **Form Validation**: Zod schema validation (`loginSchema`, `registerSchema`, `createClassroomSchema`)
- **Styling**: Tailwind CSS with custom accessibility themes, responsive flex/grid layouts, and low-vision typography (`Atkinson Hyperlegible`).

---

## 2. Directory Structure

```
apps/classroom-web/
├── index.html                  ── HTML shell with local Atkinson font imports
├── vite.config.js              ── Vite configuration with API & WebSocket proxy
├── tailwind.config.js          ── Tailwind color system and font definitions
├── src/
│   ├── main.jsx                ── Application bootstrap using ReactDOM.createRoot
│   ├── App.jsx                 ── Route declarations & access guards
│   │
│   ├── components/
│   │   └── common/             ── Reusable, accessible UI components (Button, Input, Modal, StatusBadge, etc.)
│   │
│   ├── context/
│   │   ├── AuthContext.jsx     ── JWT session state, user role, login/logout actions
│   │   └── AccessibilityContext.jsx ── Caption size slider, high-contrast themes, focus mode
│   │
│   ├── hooks/
│   │   ├── useAuth.js          ── Auth context hook
│   │   ├── useAccessibility.js ── Accessibility context hook
│   │   ├── useWebSocket.js     ── Real-time session socket client with deduplication
│   │   └── useMicrophone.js    ── Browser speech recognition wrapper
│   │
│   ├── layouts/
│   │   └── AppLayout.jsx       ── Application frame (Navbar, container, accessible footer)
│   │
│   ├── pages/
│   │   ├── LoginPage.jsx       ── Controlled login form with Zod validation
│   │   ├── RegisterPage.jsx    ── Student/teacher registration with role picker
│   │   ├── DashboardPage.jsx   ── Classroom management & LAN Wi-Fi connection info
│   │   ├── ClassroomDetailPage.jsx ── Lecture history, join code rotation, vocabulary rules
│   │   ├── LiveClassroomPage.jsx   ── Live captions, teacher mic, MediaPipe gesture HUD, flags
│   │   ├── TranscriptPage.jsx  ── Searchable lecture transcript with multi-format export
│   │   └── DemoPage.jsx        ── Offline interactive simulation for presentations
│   │
│   ├── schemas/                ── Zod client-side form schemas
│   ├── services/
│   │   └── api.js              ── Fetch API REST client connected to Express
│   └── styles/
│       └── index.css           ── Tailwind directives & theme class definitions
```

---

## 3. INT252 (ReactJS) Syllabus Alignment

| Syllabus Unit | Concept | Implementation File |
|---|---|---|
| **Unit I** | Functional Components & JSX | [App.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/App.jsx), [Button.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/components/common/Button.jsx) |
| **Unit II** | Component Composition & Props | [Modal.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/components/common/Modal.jsx), [Input.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/components/common/Input.jsx) |
| **Unit III** | State, Effects, & Custom Hooks | [useWebSocket.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/hooks/useWebSocket.js), [useMicrophone.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/hooks/useMicrophone.js) |
| **Unit IV** | Forms & Schema Validation | [auth.schema.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/schemas/auth.schema.js), [LoginPage.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/pages/LoginPage.jsx) |
| **Unit V** | Routing & Guarded Routes | [App.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/App.jsx) (`ProtectedRoute`, `PublicOnlyRoute`) |
| **Unit VI** | Context API State Management | [AuthContext.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/context/AuthContext.jsx), [AccessibilityContext.jsx](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/classroom-web/src/context/AccessibilityContext.jsx) |
