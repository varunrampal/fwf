# Foreign Worker Files

A progressive web app for maintaining foreign worker records with login-protected access and Turso-backed storage.

## Stack

- Frontend: React + Vite
- Design: Tailwind CSS
- PWA: Web manifest + service worker
- Backend: Node.js + Express
- Database: Turso via `@libsql/client`
- Auth: Email/password login with JWT
- Extraction: Local OCR and text parsing for passport and LMIA review flows

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an `.env.local` file from `.env.example` and set your Turso credentials.

   For local development without Turso, leave `TURSO_DATABASE_URL` empty or remove it. The server will use `server/data/local.db`.

   The backend loads `.env` first, then `.env.local`, so local values can override shared defaults.

   Uploaded passport and LMIA files are processed with local OCR for extraction. After you review and confirm an import, the app saves the passport file and the LMIA file in `UPLOAD_DIR` with metadata in Turso. If an LMIA document with the same LMIA number is already saved, the app reuses the existing LMIA file instead of storing another copy.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open `http://127.0.0.1:3000`.

If no admin account exists, the server seeds one from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The example credentials are only for local development; change them before deployment.

## Production

Build the frontend and serve it through Express:

```bash
npm run build
npm start
```
