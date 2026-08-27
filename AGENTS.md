# AGENTS.md

Guidance for AI agents and developers working in this repository. Read this before making changes so your work matches existing conventions.

## Repository layout

- **Monorepo (no workspace tooling)** — two independent Node apps, each with its own `package.json` and `node_modules`.
  - `Backend/` — Express REST API (CommonJS, `require`/`module.exports`).
  - `Frontend/` — React 19 + Vite SPA (ESM, `import`/`export`).
  - Root `package.json` — only `axios`; not used for building/running either app.
- Tests: none configured (`npm test` just echoes an error). Verify changes by running the dev servers and exercising the relevant flows.

## Commands

Backend (run in `Backend/`):

- `npm run dev` — nodemon on `server.js` (port 3000)
- `npm start` — plain node `server.js`
- `npm run install:browsers` — install Playwright chromium
- `postinstall` — auto-attempts Playwright chromium install (non-fatal on failure)

Frontend (run in `Frontend/`):

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — production build
- `npm run lint` — ESLint (run after editing the frontend)
- `npm run preview` — preview build

## Environment

- Backend reads `Backend/.env` (root `.gitignore` excludes `.env`). Never commit secrets.
- Required vars: `MONGO_URI`, `GOOGLE_GENAI_API_KEY`, `JWT`.
- Optional email: `EMAIL_USER`/`EMAIL_PASS`/`EMAIL_SERVICE` or `SMTP_*`. When absent, mail falls back to Ethereal test transport (returns a preview URL, does not deliver).
- CORS allows only `http://localhost:5173`. Change `src/app.js` if the frontend origin differs.

## Backend conventions

- **CommonJS** style. `require`, `module.exports`, not ESM imports.
- Delete from `Backend/` shelf files that are dev leftovers (the `_*.js`, `_*.pdf` files in the `Backend/` root are scratch/test artifacts, not part of the app).
- Layout: `routes/` (thin, define paths + middleware) → `controllers/` (request handling) → `services/` (business logic). Business logic belongs in `services/`.
- Auth: JWT in an http cookie named `token`; `authMiddleware` verifies it and checks the `blacklist` model. Mount this middleware on any protected route.
- File uploads: `multer` (`src/middleware/file.middleware.js`) with in-memory storage, 3 MB limit. Attachment routes use `upload.single("resume")`.
- AI calls: Gemini (GoogleGenAI). Patterns to reuse:
  - Structured outputs via a JSON schema (fields so the model cannot invent titles/companies/URLs/skills).
  - `withRetry` for transient 429/503 responses.
  - Deterministic fallbacks (keyword overlap scoring, local profile extraction) when the model is unavailable.
- Scrapers (`services/scraper.service.js`, `browser.service.js`):
  - Use Playwright (fallback to Puppeteer's Chrome when Playwright's binary is absent).
  - Never invent posting links/titles/companies — only return what was scraped. See `isRealJobPostingUrl`/`normalizeJobLink`.
  - Preserve `diagnostics` so blocked platforms are reported to the user instead of appearing as "no matches."
- PDF: `pdf.service.js` renders HTML → PDF via Puppeteer; `atsResume.service.js` builds ATS-safe resumes. ATS resumes must stay single-column, no tables/multi-column CSS/placeholders.
- Email: `email.service.js` via Nodemailer. Omit `attachments` array entirely when empty (some SMTP servers reject an empty array).

## Frontend conventions

- **React 19 + Vite**, ESM. Routing with `react-router-dom` v7 (`createBrowserRouter` in `src/app.routes.jsx`).
- Feature-based structure under `src/features/` (`auth`, `ai`, `jobs`), each with `pages/`, `services/` (axios API wrappers), and optionally `hooks/`, `components/`, `styles/`.
- API wrappers use a shared axios instance — base URL `http://localhost:3000`, `withCredentials: true`. Keep CORS credentials aligned with the backend.
- Styling: SCSS (`.scss`) compiled by `sass`, plus Tailwind CSS 4 (via `@tailwindcss/vite`). Follow existing class naming (`kebab-case` with BEM-ish `__`/`--` suffixes).
- State sharing uses React Context (`auth.context.jsx`, `interviewContext.jsx`) plus custom hooks (`useInterview`).
- Run `npm run lint` after edits in the frontend.

## Coding style & safety

- Do not add comments unless they clarify intent; the codebase uses comments sparingly and meaningfully (e.g. explaining *why* a scraper detail exists).
- Security: never log or commit API keys/secrets. Validate uploaded files (e.g. PDF magic-byte check in `jobController.js`) — don't trust client-supplied content types.
- When changing AI prompt/schema: keep "only facts from the candidate profile, never invent" constraints — they exist because invented content reaches real employers.
