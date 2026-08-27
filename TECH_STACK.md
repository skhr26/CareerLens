# Tech Stack

This project is a two-app monorepo with no workspace tooling. Below is the complete technology breakdown.

## Summary

| Layer      | Technology                                      |
|------------|-------------------------------------------------|
| Backend    | Node.js, Express 5                               |
| Frontend   | React 19, Vite 8                                 |
| Language   | JavaScript (CommonJS on backend, ESM on frontend)|
| Database   | MongoDB (Mongoose ODM)                           |
| AI         | Google Generative AI (Gemini)                    |
| Scraping   | Playwright, Puppeteer, Cheerio, Axios            |
| PDF        | Puppeteer (HTML→PDF), pdf-parse                  |
| Email      | Nodemailer                                       |
| Auth       | JWT (cookie-based), bcrypt                       |
| Validation | Zod                                              |
| Styling    | SCSS, Tailwind CSS 4                             |

## Backend `/Backend`

**Runtime & framework**

- Node.js
- Express `^5.2.1` — REST API framework
- `cors` — CORS middleware (origin `http://localhost:5173`)
- `cookie-parser` — parse cookies for JWT auth
- `dotenv` — environment variable loading

**Database**

- MongoDB via Mongoose `^9.9.1` — user, interview report, and token-blacklist models

**AI**

- `@google/genai` `^2.16.0` — Gemini API for interview reports, profile extraction, job scoring, cold-email generation, and ATS resume content
- `zod` `^4.4.3` + `zod-to-json-schema` `^3.25.2` — schema validation for structured AI outputs

**Scraping**

- `playwright` `^1.62.1` — headless Chromium browser automation for job boards
- `puppeteer` `^25.7.0` — fallback Chromium for scrapers and PDF rendering
- `cheerio` `^1.2.0` — HTML parsing for scraped pages
- `axios` — HTTP requests (e.g. LinkedIn guest endpoints)

**Auth & security**

- `jsonwebtoken` `^9.0.3` — JWT signing/verification
- `bcrypt` `^6.0.0` — password hashing
- `multer` `^2.2.0` — in-memory file uploads (3 MB limit)

**PDF**

- `puppeteer` — HTML → PDF rendering
- `pdf-parse` `^2.4.5` — PDF text extraction and extraction verification

**Email**

- `nodemailer` `^9.0.5` — SMTP/Gmail/Ethereal email sending

## Frontend `/Frontend`

**Framework & build**

- React `^19.2.8`
- Vite `^8.2.0` — build tool/dev server
- `@vitejs/plugin-react` `^6.0.4`

**Routing & state**

- `react-router-dom` `^7.18.2` — `createBrowserRouter`, route guards
- React Context (`auth.context.jsx`, `interviewContext.jsx`) + custom hooks

**HTTP**

- `axios` — shared instance (base URL `http://localhost:3000`, `withCredentials: true`)

**Styling**

- SCSS via `sass` `^1.102.0` — `.scss` files with BEM-ish naming
- Tailwind CSS 4 via `@tailwindcss/vite` `^4.3.3`

**Linting**

- ESLint `^10.8.0` with `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`

## Root

- `package.json` — only `axios` (shared transitive dependency; not used to build either app)

## Key libraries by purpose (quick reference)

| Purpose                    | Library             |
|----------------------------|---------------------|
| REST framework             | Express             |
| Object modeling            | Mongoose            |
| AI text generation         | `@google/genai`     |
| Schema validation          | Zod                 |
| Browser automation         | Playwright/Puppeteer|
| HTML parsing               | Cheerio             |
| PDF generation             | Puppeteer           |
| PDF text extraction        | pdf-parse           |
| Email                      | Nodemailer          |
| Auth                       | jsonwebtoken, bcrypt|
| File uploads               | multer              |
| Frontend framework         | React 19            |
| Frontend build             | Vite                |
| Routing                    | react-router-dom    |
| Styling                    | SCSS, Tailwind 4    |
