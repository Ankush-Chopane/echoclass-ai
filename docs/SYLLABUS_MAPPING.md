# Syllabus mapping — ReactJS (INT252) and Next.js (INT257)

> The official unit lists were not supplied, so this maps the project to the **topics usually taught under these course titles**. Each row points at real code. Adjust the topic names to your own syllabus wording.

## ReactJS (INT252) — `apps/classroom-web`

| Topic | Where it is used |
|---|---|
| Components, props, JSX, composition | `components/common/*` (Button, Input, Modal, Navbar, StatusBadge), `components/live/SignInputPanel.jsx` |
| Conditional rendering, lists and keys | Dashboard cards, caption log, roster (`pages/DashboardPage.jsx`, `LiveClassroomPage.jsx`) |
| State: `useState` | Forms, modals, tabs (`ClassroomDetailPage.jsx`) |
| Side effects: `useEffect` (+ cleanup) | Data loading, camera/WebSocket lifecycle (`hooks/useWebSocket.js`, `useHandTracker.js`) |
| `useRef`, `useCallback`, `useMemo` | Video element and caption scroller, stable callbacks, context values (`AuthContext.jsx`) |
| `useReducer` | Caption/presence/request state of the live room (`hooks/useWebSocket.js`) |
| Context API | `context/AuthContext.jsx` (user + token), `context/AccessibilityContext.jsx` (text size, contrast) |
| Custom hooks | `useWebSocket`, `useSpeechRecognition`, `useOfflineSpeech`, `useHandTracker`, `useAuth`, `useAccessibility` |
| Routing (React Router 6): nested routes, params, redirects, protected routes | `App.jsx`, `layouts/AppLayout.jsx` (`Outlet`), `useParams`/`useNavigate` in pages |
| Controlled forms and validation | Login/Register/Create/Join/Vocabulary forms with **zod** schemas (`schemas/*.js`); server field errors shown from `err.fields` |
| Data fetching and error handling | `services/api.js` (fetch wrapper, `ApiError`, 401 handling, blob download) |
| Code splitting | `React.lazy` + `Suspense` for every page (`App.jsx`) |
| Error boundaries | `components/common/ErrorBoundary.jsx` (class component) |
| Accessibility (ARIA, focus management, live regions) | `Modal.jsx` focus trap, `role="log"`, tabs with `aria-selected`, skip link; verified by axe in `e2e/browser.mjs` |
| Build tooling | Vite config, dev proxy, env variables (`vite.config.js`) |
| Testing | `tests/api-contract.test.mjs` (API client vs real server), `e2e/browser.mjs` (Playwright) |

## Next.js (INT257) — `apps/public-web`

| Topic | Where it is used |
|---|---|
| App Router, file-based routing, layouts | `app/layout.js`, `app/page.js`, `app/about`, `app/help`, `app/features` |
| Server vs client components | Pages are server components; `components/FeedbackForm.js` and `app/error.js` are `'use client'` |
| Dynamic routes + static generation | `app/features/[slug]/page.js` with `generateStaticParams` |
| Metadata / SEO | `export const metadata` and `generateMetadata` |
| Loading, error and not-found UI | `app/loading.js`, `app/error.js`, `app/not-found.js`, `notFound()` |
| Route Handlers (REST) | `app/api/stats/route.js` |
| Server Actions + form state | `app/actions.js` (`'use server'`) with `useFormState` in `FeedbackForm.js` (validation only; stores nothing) |
| `next/link` navigation, shared components | `components/Header.js`, `Footer.js` |
| Environment variables | `NEXT_PUBLIC_CLASSROOM_URL` in `lib/site.js` |
| Build and deployment | `npm run build:public`; Render service in `render.yaml` |

Not used on purpose (no real need): SSR data fetching from a database, middleware, image optimisation, authentication in Next.js. The authenticated app is the React SPA; Next.js is the public site.
