# Public Web (`@echoclass/public-web`)

## Next.js 14 App Router Application

This application serves as the public educational portal, marketing overview, and documentation site for EchoClass AI, demonstrating the curriculum topics of **INT257: Modern Web Application Development with Next.js**.

---

## 1. Architecture & Rendering Strategies

- **Framework**: Next.js 14 App Router
- **Rendering Modes**:
  - **Static Rendering (SSG)**: `/`, `/about`, `/features`, `/help` are pre-rendered at build time with zero client overhead.
  - **Dynamic Route Static Generation (`generateStaticParams`)**: `/features/[slug]` pre-renders individual feature specifications statically.
  - **React Server Components (RSC)**: Layouts, navigation, and educational documentation render purely on the server without shipping JavaScript bundles to the browser.
  - **Client Components (`'use client'`)**: Interactivity is strictly scoped to client components like [FeedbackForm.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/components/FeedbackForm.js) and [error.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/error.js).
- **Server Actions**: [app/actions.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/actions.js) handles feedback form submission with server-side validation and audit logging without API boilerplate.
- **Route Handlers**: [app/api/stats/route.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/api/stats/route.js) provides a REST endpoint returning platform statistics.

---

## 2. Directory Structure

```
apps/public-web/
├── app/
│   ├── layout.js               ── Root layout with Next.js Metadata API
│   ├── page.js                 ── Home page (Server Component)
│   ├── loading.js              ── Loading skeleton spinner (Unit I)
│   ├── error.js                ── Client error boundary with reset button (Unit I)
│   ├── not-found.js            ── Custom 404 page (Unit I)
│   ├── actions.js              ── Next.js Server Actions ('use server') (Unit III)
│   ├── about/
│   │   └── page.js             ── About page with coursework context
│   ├── features/
│   │   ├── page.js             ── Feature catalog overview
│   │   └── [slug]/
│   │       └── page.js         ── Dynamic route with generateStaticParams (Unit II)
│   ├── help/
│   │   └── page.js             ── Documentation & embedded Server Action form
│   └── api/
│       └── stats/
│           └── route.js        ── Next.js Route Handler /api/stats (Unit III)
│
├── components/
│   ├── Header.js               ── Universal navigation header
│   ├── Footer.js               ── Universal accessible footer
│   └── FeedbackForm.js         ── Client Component with useFormState (Unit III)
│
├── lib/
│   └── features-data.js        ── Centralized feature dataset for static generation
├── next.config.js              ── Next.js configuration
└── package.json
```

---

## 3. INT257 (Next.js) Syllabus Alignment

| Syllabus Unit | Concept | Implementation File |
|---|---|---|
| **Unit I** | App Router, File-Based Routing, Layouts | [app/layout.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/layout.js), [app/loading.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/loading.js), [app/error.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/error.js) |
| **Unit II** | Server Components & Dynamic SSG | [app/page.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/page.js), [app/features/[slug]/page.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/features/[slug]/page.js) (`generateStaticParams`) |
| **Unit III** | Route Handlers & Server Actions | [app/api/stats/route.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/api/stats/route.js), [app/actions.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/actions.js), [FeedbackForm.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/components/FeedbackForm.js) |
| **Unit IV** | Role-Based Authorization Architecture | Separated: Private classroom data resides in Express API; Next.js serves public and documentation layers |
| **Unit V** | Metadata API & SEO Optimization | [app/layout.js](file:///d:/Projects/Sign%20Language%20&%20Speech-to-Text%20Classroom%20Assistant/echoclass/apps/public-web/app/layout.js) (`metadata`), dynamic `generateMetadata` in `[slug]/page.js` |
