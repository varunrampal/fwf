import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@libsql/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const localDatabasePath = path.join(rootDir, "server", "data", "local.db").replace(/\\/g, "/");

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || "dev-only-change-this-secret";
const databaseUrl = process.env.TURSO_DATABASE_URL || `file:${localDatabasePath}`;
const devMode = process.argv.includes("--dev");

await fs.mkdir(path.dirname(localDatabasePath), { recursive: true });

const db = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function execute(sql, args = {}) {
  return db.execute({ sql, args });
}

async function initializeDatabase() {
  const statements = [
    ...(databaseUrl.startsWith("file:") ? ["PRAGMA journal_mode = TRUNCATE"] : []),
    "PRAGMA foreign_keys = ON",
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_no INTEGER NOT NULL UNIQUE,
      worker_name TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL,
      agent TEXT,
      consultant TEXT,
      submitted INTEGER NOT NULL DEFAULT 0,
      submission_date TEXT,
      decision TEXT,
      lmia_number TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const statement of statements) {
    await execute(statement);
  }

  await migrateDatabase();
  await seedAdminUser();
}

async function migrateDatabase() {
  const workersInfo = await execute("PRAGMA table_info(workers)");
  const workerColumns = new Set(workersInfo.rows.map((column) => column.name));

  if (!workerColumns.has("worker_name")) {
    await execute("ALTER TABLE workers ADD COLUMN worker_name TEXT NOT NULL DEFAULT ''");
  }
}

async function seedAdminUser() {
  const email = (process.env.ADMIN_EMAIL || "admin@fwf.local").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const existing = await execute("SELECT id FROM users WHERE email = :email LIMIT 1", { email });

  if (existing.rows.length) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await execute(
    "INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :passwordHash)",
    {
      name: "Administrator",
      email,
      passwordHash
    }
  );

  console.log(`Seeded admin user ${email}. Change ADMIN_PASSWORD before production use.`);
}

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function toNullableText(value) {
  const text = toText(value);
  return text ? text : null;
}

function toSubmitted(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function toWorker(row) {
  return {
    id: Number(row.id),
    file_no: Number(row.file_no),
    worker_name: row.worker_name || "",
    company: row.company || "",
    agent: row.agent || "",
    consultant: row.consultant || "",
    submitted: Boolean(row.submitted),
    submission_date: row.submission_date || "",
    decision: row.decision || "",
    lmia_number: row.lmia_number || "",
    note: row.note || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function getWorkerPayload(body) {
  return {
    workerName: toText(body.worker_name),
    company: toText(body.company),
    agent: toNullableText(body.agent),
    consultant: toNullableText(body.consultant),
    submitted: toSubmitted(body.submitted),
    submissionDate: toNullableText(body.submission_date),
    decision: toNullableText(body.decision),
    lmiaNumber: toNullableText(body.lmia_number),
    note: toNullableText(body.note)
  };
}

function getFileNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000) {
    return null;
  }
  return parsed;
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name
    },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

async function requireAuth(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const result = await execute("SELECT id, name, email FROM users WHERE id = :id LIMIT 1", {
      id: Number(payload.sub)
    });

    if (!result.rows.length) {
      return res.status(401).json({ error: "Authentication required." });
    }

    req.user = result.rows[0];
    return next();
  } catch {
    return res.status(401).json({ error: "Authentication required." });
  }
}

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = toText(req.body.email).toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await execute("SELECT id, name, email, password_hash FROM users WHERE email = :email LIMIT 1", {
      email
    });

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid login." });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid login." });
    }

    res.json({
      token: signToken(user),
      user: {
        id: Number(user.id),
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: Number(req.user.id),
      name: req.user.name,
      email: req.user.email
    }
  });
});

app.get("/api/workers", requireAuth, async (req, res, next) => {
  try {
    const search = toText(req.query.search);
    const args = {};
    let where = "";

    if (search) {
      args.search = `%${search}%`;
      where = `WHERE
        CAST(w.file_no AS TEXT) LIKE :search
        OR w.worker_name LIKE :search
        OR w.company LIKE :search
        OR IFNULL(w.agent, '') LIKE :search
        OR IFNULL(w.consultant, '') LIKE :search
        OR IFNULL(w.lmia_number, '') LIKE :search
        OR IFNULL(w.decision, '') LIKE :search
        OR IFNULL(w.note, '') LIKE :search`;
    }

    const result = await execute(
      `SELECT w.*
       FROM workers w
       ${where}
       ORDER BY w.file_no DESC`,
      args
    );

    res.json({ workers: result.rows.map(toWorker) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/workers", requireAuth, async (req, res, next) => {
  try {
    const payload = getWorkerPayload(req.body);
    const fileNo = getFileNumber(req.body.file_no);

    if (!payload.workerName) {
      return res.status(400).json({ error: "Worker name is required." });
    }

    if (!payload.company) {
      return res.status(400).json({ error: "Company is required." });
    }

    const result = await execute(
      `INSERT INTO workers (
        file_no, worker_name, company, agent, consultant, submitted, submission_date, decision, lmia_number, note
      )
      VALUES (
        COALESCE(:fileNo, (SELECT COALESCE(MAX(file_no), 1999) + 1 FROM workers)),
        :workerName, :company, :agent, :consultant, :submitted, :submissionDate, :decision, :lmiaNumber, :note
      )`,
      {
        fileNo,
        ...payload
      }
    );

    const worker = await execute(
      `SELECT w.*
       FROM workers w
       WHERE w.id = :id`,
      { id: Number(result.lastInsertRowid) }
    );

    res.status(201).json({ worker: toWorker(worker.rows[0]) });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "That file number already exists." });
    }
    next(error);
  }
});

app.get("/api/workers/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const workerResult = await execute(
      `SELECT w.*
       FROM workers w
       WHERE w.id = :id`,
      { id }
    );

    if (!workerResult.rows.length) {
      return res.status(404).json({ error: "Worker record not found." });
    }

    res.json({
      worker: toWorker(workerResult.rows[0])
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/workers/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const payload = getWorkerPayload(req.body);

    if (!payload.workerName) {
      return res.status(400).json({ error: "Worker name is required." });
    }

    if (!payload.company) {
      return res.status(400).json({ error: "Company is required." });
    }

    const existing = await execute("SELECT id FROM workers WHERE id = :id LIMIT 1", { id });
    if (!existing.rows.length) {
      return res.status(404).json({ error: "Worker record not found." });
    }

    await execute(
      `UPDATE workers
       SET worker_name = :workerName,
           company = :company,
           agent = :agent,
           consultant = :consultant,
           submitted = :submitted,
           submission_date = :submissionDate,
           decision = :decision,
           lmia_number = :lmiaNumber,
           note = :note,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        id,
        ...payload
      }
    );

    const updated = await execute(
      `SELECT w.*
       FROM workers w
       WHERE w.id = :id`,
      { id }
    );

    res.json({ worker: toWorker(updated.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/workers/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const deleted = await execute("DELETE FROM workers WHERE id = :id", { id });

    if (!deleted.rowsAffected) {
      return res.status(404).json({ error: "Worker record not found." });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

async function configureFrontend() {
  if (devMode) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: rootDir,
      appType: "custom",
      server: {
        middlewareMode: true
      }
    });

    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const template = await fs.readFile(path.join(rootDir, "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
    return;
  }

  try {
    await fs.access(distDir);
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } catch {
    console.warn("No frontend build found. Run npm run build before npm start.");
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({ error: "Something went wrong." });
});

await initializeDatabase();
await configureFrontend();

app.listen(port, () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
  if (devMode) {
    console.log(`App available at http://127.0.0.1:${port}`);
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.log(`Using local database file: ${localDatabasePath}`);
  }
});
