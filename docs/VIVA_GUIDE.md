# Viva Guide — EchoClass AI

> This guide prepares you to explain and defend your project in a college viva examination. Read each section, understand the reasoning, and practice saying the answers out loud.

---

## 1. Simple Project Introduction

**"Tell me about your project in two minutes."**

> EchoClass AI is an accessibility web application designed for classrooms. Its main purpose is to help students who are deaf or hard of hearing participate fully in lectures.
>
> Here is how it works: The teacher runs the application on a laptop and speaks into the microphone. The application uses speech recognition to convert the lecture into captions in real time. These captions are sent instantly to every student connected on the classroom's local Wi-Fi network. Students read the captions on their phones or laptops.
>
> Students can also respond without speaking. They can make predefined hand poses in front of their camera — for example, raising a thumb to say "understood" — and the camera in their browser converts the gesture into text. Students can also tap quick-request buttons like "Please slow down" or type a message. The teacher sees all of this in real time.
>
> Every lecture is saved as a transcript that can be searched and downloaded in multiple formats. There is also an optional AI feature that can generate study notes from the lecture.
>
> The application runs on a single Node.js server. It does not require a cloud subscription for the core features. A teacher can run it on a laptop in a classroom without any internet connection.

---

## 2. Why Was This Project Needed?

**"What problem does this solve?"**

> Students with hearing disabilities are often unable to follow lectures that rely entirely on verbal communication. Professional sign-language interpreters and captioners are expensive and not available in every classroom. Existing captioning tools usually require a cloud subscription, specific hardware, or a video conference call — none of which fit a typical Indian college classroom with limited resources and unreliable internet.
>
> EchoClass AI addresses this by running locally on the teacher's laptop, using the browser's built-in speech recognition, and sharing captions over the local network. It is free, requires only a laptop and a Wi-Fi router, and works even without internet.

---

## 3. Why Are Frontend and Backend Separated?

**"Why did you separate the frontend from the backend?"**

> The frontend is responsible for what the user sees and interacts with: the React components, Tailwind styling, and JavaScript that runs in the browser. It never touches the database or handles secrets like passwords.
>
> The backend is responsible for data storage, authentication, business logic, and security. It runs on the server where secrets like the JWT signing key and database are protected.
>
> This separation makes the code easier to understand and maintain. It also means the frontend cannot accidentally expose secrets — the API key for the AI provider, for example, never reaches the browser.
>
> In this project, both run as one deployed service: the Node.js server serves the built React files and also handles the API. A separate Next.js site is the public marketing website. There is no need for a separate frontend hosting service.

---

## 4. Why SQLite?

**"Why did you choose SQLite instead of MongoDB or MySQL?"**

> SQLite is a file-based database that is embedded directly in the application. There is no separate database server to install, configure, or manage. This has several advantages for this project:
>
> 1. **Simplicity:** A teacher can set up the application by running two commands (`npm ci` and `npm start`). There is nothing else to install.
> 2. **Portability:** The entire database is one file. Backup is just copying the file.
> 3. **Performance:** For a classroom with 40 students, SQLite easily handles all the queries. Each query takes less than a millisecond.
> 4. **Reliability:** SQLite has been around since 2000 and is used in billions of devices. It supports transactions, foreign keys, and even full-text search through FTS5.
>
> MongoDB would add complexity without benefit at this scale. PostgreSQL requires a running server process. SQLite is the right tool for this problem.

---

## 5. How Does Authentication Work?

**"Explain your authentication system."**

> When a user registers or logs in, the server:
> 1. Looks up the user in the database by email.
> 2. Compares the submitted password against the stored bcrypt hash using `bcrypt.compare()`. bcrypt is a password hashing algorithm designed to be slow — this makes brute-force attacks impractical.
> 3. If correct, signs a **JWT (JSON Web Token)** containing the user's ID, role, and a token version number. The JWT is signed with a secret key (`JWT_SECRET`) that only the server knows.
> 4. Sends the JWT to the browser.
>
> On every subsequent request, the browser sends the JWT in the `Authorization: Bearer <token>` header. The server:
> 1. Verifies the JWT signature — this proves the token was issued by this server and has not been tampered with.
> 2. Looks up the user in the database — this confirms the account still exists.
> 3. Checks that the `token_version` in the token matches the database — if the user changes their password or logs out everywhere, the version is incremented and all old tokens become invalid immediately.
>
> **Important:** The role is always read from the database, never trusted from the token. This prevents a user from crafting a token that claims to be a teacher.

---

## 6. How Are Captions Processed and Delivered?

**"Walk me through how a caption gets from the teacher's voice to the student's screen."**

> 1. The teacher's microphone is captured by the browser's **Web Speech API**. This is a built-in browser feature — no audio is sent to our server by default.
> 2. The browser speech recognition produces interim (partial) and final (complete) results.
> 3. The frontend JavaScript (`speech.js`) listens for these events and sends a WebSocket message to the server: `{ type: "caption", source: "speech", final: true, text: "The cell is the basic unit of life." }`.
> 4. The server's **WebSocket hub** (`realtime.js`) receives this message. It validates the message, applies any vocabulary corrections (e.g., replacing "sir" with "CRISPR"), and saves the caption to the SQLite database.
> 5. The server then broadcasts the caption to all students connected to that session's WebSocket room: `{ type: "caption", caption: { id, text, speaker, t_ms } }`.
> 6. Each student's browser receives this WebSocket message and the JavaScript updates the DOM to display the new caption.
>
> The entire process takes less than 100 milliseconds on a local network.

---

## 7. How Do WebSockets Work?

**"What is a WebSocket and why did you use it?"**

> A regular HTTP request is one-way: the browser asks the server something, the server replies, and the connection closes. If the teacher says something, the server cannot push the caption to students automatically — students would have to keep asking "is there a new caption?" This is called **polling** and is inefficient.
>
> A **WebSocket** is a persistent, two-way connection. Once opened, both the browser and server can send messages to each other at any time without the overhead of a new HTTP connection. This is perfect for live captions because each new caption can be pushed to all connected students instantly.
>
> In this project, I use the `ws` library on the server side and the browser's built-in `WebSocket` API on the client side.
>
> **Security:** I do not pass the JWT token in the WebSocket URL because URLs appear in browser history and server logs. Instead, I use a **ticket system**: the browser first calls a REST endpoint to get a short-lived single-use ticket (valid 30 seconds), then uses that ticket to open the WebSocket. The server validates the ticket, checks classroom membership, and then allows the connection.

---

## 8. How Does the Application Handle Accessibility?

**"What accessibility features have you implemented?"**

> The application was built with accessibility as a primary goal, not an afterthought:
>
> - **Caption size:** Adjustable from 18 px to 96 px using a slider.
> - **Colour themes:** Light, dark, high-contrast (white/yellow on black), and yellow-on-black. The high-contrast themes meet WCAG AA requirements.
> - **Font:** The Atkinson Hyperlegible font is used by default. It was specifically designed for people with low vision.
> - **Focus mode:** Shows only the last 3 captions to reduce distraction.
> - **Screen reader support:** New captions are announced via a live ARIA region. All interactive elements have accessible labels. Semantic HTML is used throughout.
> - **Keyboard navigation:** All interactive elements are reachable and usable without a mouse.
> - **Skip link:** A "Skip to main content" link at the top of the page.
> - **Microphone and camera permissions:** The application only requests permissions when the teacher or student actually needs them, with a clear explanation.

---

## 9. Known Technical Limitations

**"What are the limitations of your project?"**

> 1. **Speech recognition accuracy:** The Web Speech API and Vosk both make mistakes, especially on technical vocabulary. The vocabulary correction feature helps, but is not a complete solution.
>
> 2. **Gesture recognition is limited:** The application recognises only 12 predefined hand poses. It is not a sign-language translation system. This is clearly disclosed in the UI.
>
> 3. **Browser compatibility:** The Web Speech API is not available in Firefox. Teachers on Firefox can only type captions. Students on all browsers can read captions.
>
> 4. **Single server:** The in-memory rate limiter does not work if you run multiple server processes. The application is designed for a single instance.
>
> 5. **No offline student access:** Students must be connected to the same network as the teacher's laptop. They cannot access captions offline.
>
> 6. **AI summaries require internet:** The optional AI feature sends the lecture transcript to an external AI provider. The core captioning works entirely offline.

---

## 10. Common Viva Questions and Answers

**Q: What is Node.js?**
> Node.js is a JavaScript runtime that runs on the server. It uses an event-driven, non-blocking I/O model, which makes it efficient for handling many simultaneous WebSocket connections.

**Q: What is Express?**
> Express is a minimal web framework for Node.js. It handles HTTP routing, middleware, and request/response management. I used Express 5, the latest version.

**Q: What is JWT?**
> JWT stands for JSON Web Token. It is a compact, signed token that proves identity. The server signs it with a secret key, and any attempt to modify the token invalidates the signature. It allows stateless authentication — the server does not need to store session state.

**Q: What is bcrypt?**
> bcrypt is a password hashing algorithm. It is deliberately slow (configurable cost factor), which makes brute-force attacks impractical. It also includes a random salt, so two users with the same password will have different hashes.

**Q: What is a prepared statement?**
> A prepared statement is a pre-compiled SQL query. The database compiles it once at startup. When a request comes in, only the parameter values are sent — the SQL structure cannot be changed. This prevents SQL injection attacks and is faster than building queries as strings.

**Q: What is full-text search?**
> SQLite's FTS5 (Full-Text Search version 5) creates an inverted index of all words in the captions. This allows searching for words across millions of captions in milliseconds, without scanning every row. Three database triggers keep the FTS index in sync with the captions table automatically.

**Q: What is a WebSocket?**
> A WebSocket is a persistent bidirectional connection between the browser and server. Unlike HTTP, the server can push messages to the browser at any time. This is used for live captions — each new caption is pushed to all connected students immediately.

**Q: What is MediaPipe?**
> MediaPipe is a machine learning framework from Google. In this project, I use the HandLandmarker model from the `@mediapipe/tasks-vision` package. It runs entirely in the browser using WebAssembly and processes camera frames to detect 21 hand landmark points. The gesture classifier then interprets these landmarks to recognise hand poses.

**Q: What is a service worker?**
> A service worker is a JavaScript file that runs in the background in the browser. It intercepts network requests and can cache responses. In this project, it caches the app shell (HTML, CSS, JS) so the application loads faster and can show a basic shell even without internet.

**Q: How would you scale this for 1000 students?**
> The current architecture uses in-memory rate limiting and SQLite, which work for a single server instance. For large scale, I would:
> 1. Move to PostgreSQL for the database (supports multiple simultaneous writers).
> 2. Use Redis for rate limiting and WebSocket session state (shared across multiple server instances).
> 3. Put a load balancer with sticky sessions in front to route WebSocket connections correctly.
> But for the intended use case — a single classroom — the current architecture is perfectly adequate.

---

## 11. Execution Flow Summary (for a quick viva answer)

**"Explain the execution flow of your application."**

> **Startup:**
> `apps/backend/src/server.js` reads environment variables → validates them with `config.js` → opens SQLite via `db.js` → runs any pending migrations → creates the Express app with all API routes → starts the HTTP server.

> **A student registers:**
> Browser POSTs to `/api/auth/register` → server validates input → hashes password with bcrypt → saves to users table → returns JWT → browser stores token in localStorage.

> **A live class:**
> Teacher starts session (POST `/api/classrooms/:id/sessions`) → gets WebSocket ticket → connects WebSocket → speaks → Web Speech API produces text → browser sends it over WebSocket → server validates and saves caption → broadcasts to all connected student WebSockets → React state updates and the caption appears.

> **After the class:**
> Teacher ends session → all WebSockets close → students can view the transcript → download it as TXT/SRT/VTT/JSON → optionally generate AI study notes.

---

## 12. Questions about this revision

**"What was broken in the project you received and how did you find it?"** — The server crashed at start (`fs` was never imported), so every test failed. I ran the tests first, fixed that, then compared the React API calls with the real routes and found mismatched endpoints and response shapes. The integration test (`apps/classroom-web/tests/api-contract.test.mjs`) now runs the real React client against the real server so that cannot silently regress.

**"Why React *and* Next.js?"** — The classroom is an authenticated, real-time single-page app (React + Vite, served by Express). The public site is mostly static content that benefits from Next.js routing, metadata and static generation. Each tool is used where it fits.

**"Is the gesture recognition real?"** — The hand tracking is real (MediaPipe HandLandmarker in the browser). The mapping from landmarks to 12 poses is hand-written geometry, not a trained or validated classifier, and no accuracy is claimed. It is not sign-language translation.

**"Why fetch + Blob for downloads?"** — Browsers do not send an Authorization header on a normal link, so the JWT would be missing.

**"What did you not verify?"** — Real Vosk recognition, hand-recognition accuracy, live AI providers, the Docker build, Render deployment and screen-reader behaviour (see README → Verification status).

**"Why Next.js 14 with known advisories?"** — The fix is a major upgrade to Next 16; the site is static and uses none of the affected features, but it should be upgraded before a public launch.

---

*Remember: It is perfectly fine to say "I don't know the exact implementation detail, but I understand the concept and can look it up." Examiners respect honest, thoughtful answers over guessing.*
