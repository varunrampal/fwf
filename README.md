# Foreign Worker Files

A progressive web app for maintaining foreign worker records with login-protected access and Turso-backed storage.

## Stack

- Frontend: React + Vite
- Design: Tailwind CSS
- PWA: Web manifest + service worker
- Backend: Node.js + Express
- Database: Turso via `@libsql/client`
- Auth: Email/password login with JWT

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an `.env.local` file from `.env.example` and set your Turso credentials.

   For local development without Turso, leave `TURSO_DATABASE_URL` empty or remove it. The server will use `server/data/local.db`.

   The backend loads `.env` first, then `.env.local`, so local values can override shared defaults.

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
