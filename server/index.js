import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
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
const maxImportMb = Number(process.env.MAX_IMPORT_MB || 15);
const ocrCacheDir = path.join(rootDir, "server", "ocr-cache");
const configuredUploadDir = process.env.UPLOAD_DIR || path.join("server", "uploads");
const uploadDir = path.isAbsolute(configuredUploadDir)
  ? configuredUploadDir
  : path.resolve(rootDir, configuredUploadDir);

console.log("Starting Foreign Worker Files API", {
  nodeEnv: process.env.NODE_ENV || "development",
  nodeVersion: process.version,
  port,
  rootDir,
  uploadDir,
  hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
  hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN)
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

await fs.mkdir(path.dirname(localDatabasePath), { recursive: true });
await fs.mkdir(ocrCacheDir, { recursive: true });
await fs.mkdir(uploadDir, { recursive: true });

const db = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImportMb * 1024 * 1024,
    files: 2
  }
});

let ocrWorkerPromise;
let ocrQueue = Promise.resolve();

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
      passport_number TEXT,
      company TEXT NOT NULL,
      position TEXT,
      agent TEXT,
      consultant TEXT,
      submitted INTEGER NOT NULL DEFAULT 0,
      submission_date TEXT,
      decision TEXT,
      lmia_number TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id INTEGER,
      document_type TEXT NOT NULL,
      document_key TEXT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS worker_documents (
      worker_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (worker_id, document_id),
      FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
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

  if (!workerColumns.has("passport_number")) {
    await execute("ALTER TABLE workers ADD COLUMN passport_number TEXT");
  }

  if (!workerColumns.has("position")) {
    await execute("ALTER TABLE workers ADD COLUMN position TEXT");
  }

  const documentsInfo = await execute("PRAGMA table_info(documents)");
  const documentColumns = new Set(documentsInfo.rows.map((column) => column.name));

  if (!documentColumns.has("worker_id")) {
    await execute("ALTER TABLE documents ADD COLUMN worker_id INTEGER");
  }

  if (!documentColumns.has("document_type")) {
    await execute("ALTER TABLE documents ADD COLUMN document_type TEXT NOT NULL DEFAULT 'document'");
  }

  if (!documentColumns.has("document_key")) {
    await execute("ALTER TABLE documents ADD COLUMN document_key TEXT");
  }

  if (!documentColumns.has("original_name")) {
    await execute("ALTER TABLE documents ADD COLUMN original_name TEXT NOT NULL DEFAULT ''");
  }

  if (!documentColumns.has("stored_name")) {
    await execute("ALTER TABLE documents ADD COLUMN stored_name TEXT");
  }

  if (!documentColumns.has("mime_type")) {
    await execute("ALTER TABLE documents ADD COLUMN mime_type TEXT");
  }

  if (!documentColumns.has("size")) {
    await execute("ALTER TABLE documents ADD COLUMN size INTEGER NOT NULL DEFAULT 0");
  }

  if (!documentColumns.has("created_at")) {
    await execute("ALTER TABLE documents ADD COLUMN created_at TEXT");
  }

  const workerDocumentsInfo = await execute("PRAGMA table_info(worker_documents)");
  const workerDocumentColumns = new Set(workerDocumentsInfo.rows.map((column) => column.name));

  if (!workerDocumentColumns.has("document_type")) {
    await execute("ALTER TABLE worker_documents ADD COLUMN document_type TEXT NOT NULL DEFAULT 'document'");
  }

  if (!workerDocumentColumns.has("created_at")) {
    await execute("ALTER TABLE worker_documents ADD COLUMN created_at TEXT");
  }

  await execute("CREATE INDEX IF NOT EXISTS worker_documents_worker_id_idx ON worker_documents(worker_id)");
  await execute("CREATE INDEX IF NOT EXISTS documents_document_key_idx ON documents(document_key)");
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS documents_lmia_number_unique_idx
     ON documents(document_key)
     WHERE document_type = 'lmia' AND document_key IS NOT NULL AND document_key <> ''`
  );
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
    passport_number: row.passport_number || "",
    company: row.company || "",
    position: row.position || "",
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

function toDocument(row, extra = {}) {
  return {
    id: Number(row.id),
    document_type: row.document_type || "",
    document_key: row.document_key || "",
    original_name: row.original_name || "",
    mime_type: row.mime_type || "",
    size: Number(row.size || 0),
    created_at: row.created_at,
    ...extra
  };
}

function normalizeDocumentKey(value) {
  return toText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sanitizeFileName(value, fallback) {
  const name = path.basename(toText(value) || fallback).replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return (name || fallback).slice(0, 180);
}

function getStoredDocumentPath(storedName) {
  const resolved = path.resolve(uploadDir, storedName);
  const relative = path.relative(uploadDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid stored document path.");
  }

  return resolved;
}

async function writeDocumentFile(file, documentType) {
  await fs.mkdir(uploadDir, { recursive: true });

  const originalName = sanitizeFileName(file.originalname, `${documentType}-document`);
  const extension = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const storedName = `${documentType}-${Date.now()}-${randomUUID()}${extension}`;
  const filePath = getStoredDocumentPath(storedName);

  await fs.writeFile(filePath, file.buffer, { flag: "wx" });

  return {
    originalName,
    storedName,
    mimeType: file.mimetype || "application/octet-stream",
    size: Number(file.size || file.buffer?.length || 0)
  };
}

async function getDocumentByKey(documentType, documentKey) {
  if (!documentKey) {
    return null;
  }

  const result = await execute(
    `SELECT *
     FROM documents
     WHERE document_type = :documentType AND document_key = :documentKey
     LIMIT 1`,
    { documentType, documentKey }
  );

  return result.rows[0] || null;
}

async function createDocument(file, documentType, documentKey = null, workerId = null) {
  const saved = await writeDocumentFile(file, documentType);

  try {
    const result = await execute(
      `INSERT INTO documents (worker_id, document_type, document_key, original_name, stored_name, mime_type, size)
       VALUES (:workerId, :documentType, :documentKey, :originalName, :storedName, :mimeType, :size)`,
      {
        workerId,
        documentType,
        documentKey,
        ...saved
      }
    );

    const document = await execute("SELECT * FROM documents WHERE id = :id", {
      id: Number(result.lastInsertRowid)
    });

    return { document: toDocument(document.rows[0]), saved: true };
  } catch (error) {
    await fs.unlink(getStoredDocumentPath(saved.storedName)).catch(() => {});
    throw error;
  }
}

async function getOrCreateLmiaDocument(file, lmiaNumber, workerId) {
  const documentKey = normalizeDocumentKey(lmiaNumber);
  const existing = await getDocumentByKey("lmia", documentKey);

  if (existing) {
    return { document: toDocument(existing), saved: false, reused: true };
  }

  try {
    const created = await createDocument(file, "lmia", documentKey, workerId);
    return { ...created, reused: false };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      const duplicate = await getDocumentByKey("lmia", documentKey);
      if (duplicate) {
        return { document: toDocument(duplicate), saved: false, reused: true };
      }
    }

    throw error;
  }
}

async function linkDocumentToWorker(workerId, documentId, documentType, { replace = false } = {}) {
  if (replace) {
    await execute(
      `DELETE FROM worker_documents
       WHERE worker_id = :workerId AND document_type = :documentType`,
      { workerId, documentType }
    );
  }

  await execute(
    `INSERT OR IGNORE INTO worker_documents (worker_id, document_id, document_type)
     VALUES (:workerId, :documentId, :documentType)`,
    { workerId, documentId, documentType }
  );
}

async function getWorkerDocuments(workerId) {
  const result = await execute(
    `SELECT d.*
     FROM worker_documents wd
     JOIN documents d ON d.id = wd.document_id
     WHERE wd.worker_id = :workerId
     ORDER BY CASE d.document_type WHEN 'passport' THEN 1 WHEN 'lmia' THEN 2 ELSE 3 END, d.created_at DESC`,
    { workerId }
  );

  return result.rows.map((row) => toDocument(row));
}

async function saveWorkerDocuments(workerId, { passport = null, lmia = null, passportNumber = "", lmiaNumber = "", replace = true }) {
  const documents = [];

  if (passport) {
    const passportResult = await createDocument(passport, "passport", normalizeDocumentKey(passportNumber) || null, workerId);
    await linkDocumentToWorker(workerId, passportResult.document.id, "passport", { replace });
    documents.push({ ...passportResult.document, saved: passportResult.saved, reused: false });
  }

  if (lmia) {
    if (!normalizeDocumentKey(lmiaNumber)) {
      throw new Error("LMIA number is required before saving the LMIA document.");
    }

    if (!isDigitsOnly(lmiaNumber)) {
      throw new Error("LMIA number must contain digits only.");
    }

    const lmiaResult = await getOrCreateLmiaDocument(lmia, lmiaNumber, workerId);
    await linkDocumentToWorker(workerId, lmiaResult.document.id, "lmia", { replace });
    documents.push({ ...lmiaResult.document, saved: lmiaResult.saved, reused: lmiaResult.reused });
  }

  return documents;
}

async function saveImportDocuments(workerId, { passport, lmia, passportNumber, lmiaNumber }) {
  return saveWorkerDocuments(workerId, { passport, lmia, passportNumber, lmiaNumber });
}

async function getWorkerById(id) {
  const result = await execute(
    `SELECT w.*
     FROM workers w
     WHERE w.id = :id`,
    { id }
  );

  if (!result.rows.length) {
    return null;
  }

  return {
    ...toWorker(result.rows[0]),
    documents: await getWorkerDocuments(id)
  };
}

function getWorkerPayload(body) {
  return {
    workerName: normalizeSpace(body.worker_name),
    passportNumber: toNullableText(body.passport_number),
    company: normalizeSpace(body.company),
    position: toNullableText(body.position),
    agent: toNullableText(normalizeSpace(body.agent)),
    consultant: toNullableText(normalizeSpace(body.consultant)),
    submitted: toSubmitted(body.submitted),
    submissionDate: toNullableText(body.submission_date),
    decision: toNullableText(body.decision),
    lmiaNumber: toNullableText(body.lmia_number),
    note: toNullableText(body.note)
  };
}

function isAlphaWords(value) {
  return /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(normalizeSpace(value));
}

function isAlphanumericWords(value) {
  return /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(normalizeSpace(value));
}

function isDigitsOnly(value) {
  return /^\d+$/.test(toText(value));
}

function validateWorkerPayload(payload) {
  if (!payload.workerName) {
    return "Worker name is required.";
  }

  if (!isAlphaWords(payload.workerName)) {
    return "Worker name must contain alphabets and spaces only.";
  }

  if (!payload.company) {
    return "Company is required.";
  }

  if (!isAlphanumericWords(payload.company)) {
    return "Company name must contain letters, numbers, and spaces only.";
  }

  if (payload.agent && !isAlphaWords(payload.agent)) {
    return "Agent must contain alphabets and spaces only.";
  }

  if (payload.consultant && !isAlphaWords(payload.consultant)) {
    return "Consultant must contain alphabets and spaces only.";
  }

  if (payload.lmiaNumber && !isDigitsOnly(payload.lmiaNumber)) {
    return "LMIA number must contain digits only.";
  }

  return "";
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

function normalizeSpace(value) {
  return toText(value).replace(/\s+/g, " ");
}

function normalizeOcrText(value) {
  return String(value || "")
    .replace(/[|]/g, "I")
    .replace(/[«‹]/g, "<")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getTextLines(value) {
  return normalizeOcrText(value)
    .split("\n")
    .map((line) => normalizeSpace(line))
    .filter(Boolean);
}

function cleanDocumentValue(value) {
  return normalizeSpace(value)
    .replace(/^[\s:./-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getLabelValue(lines, labelPatterns, { maxWords = 8 } = {}) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of labelPatterns) {
      const inline = line.match(new RegExp(`${pattern}\\s*[:：/-]?\\s*(.+)$`, "i"));
      if (inline?.[1]) {
        const value = cleanDocumentValue(inline[1]);
        if (value && !new RegExp(`^${pattern}$`, "i").test(value)) {
          return value.split(/\s+/).slice(0, maxWords).join(" ");
        }
      }

      if (new RegExp(pattern, "i").test(line) && lines[index + 1]) {
        return cleanDocumentValue(lines[index + 1]).split(/\s+/).slice(0, maxWords).join(" ");
      }
    }
  }

  return "";
}

function isLikelyLabel(line) {
  return /(?:name|number|no\.?|title|position|employer|company|business|surname|given|date|address|phone|email)\s*[:：]?\s*$/i.test(line);
}

function trimAtFollowingLabel(value) {
  const nextLabelPattern =
    /\s+(?:legal\s+business\s+name|business\s+legal\s+name|job\s+title|position|occupation|employer\s+name|company\s+name|passport\s+(?:no|number)|given\s+name(?:s)?|last\s+name|surname|lmia\s+(?:no|number)|application\s+(?:no|number))\s*[:：]/i;
  const match = value.match(nextLabelPattern);
  return match ? value.slice(0, match.index) : value;
}

function getStrictLabelValue(lines, labelPatterns, { maxWords = 8 } = {}) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of labelPatterns) {
      const inline = line.match(new RegExp(`${pattern}\\s*[:：/-]?\\s*(.+)$`, "i"));
      if (inline?.[1]) {
        const value = cleanDocumentValue(trimAtFollowingLabel(inline[1]));
        if (value && !new RegExp(`^${pattern}$`, "i").test(value)) {
          return value.split(/\s+/).slice(0, maxWords).join(" ");
        }
      }

      if (new RegExp(`^\\s*${pattern}\\s*[:：/-]?\\s*$`, "i").test(line)) {
        for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
          if (!isLikelyLabel(lines[nextIndex])) {
            return cleanDocumentValue(lines[nextIndex]).split(/\s+/).slice(0, maxWords).join(" ");
          }
        }
      }
    }
  }

  return "";
}

function normalizePassportNumber(value) {
  return toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .slice(0, 12);
}

function cleanMrzNameToken(value) {
  const token = toText(value).toUpperCase().replace(/[^A-Z]/g, "");
  if (token.length < 2 || token.length > 20) return "";
  if (/^(.)\1+$/.test(token)) return "";
  if (["IND", "CHN", "VNM", "K", "L"].includes(token)) return "";
  return token;
}

function getMrzNameTokens(value) {
  return String(value || "")
    .split("<")
    .map(cleanMrzNameToken)
    .filter(Boolean);
}

function fixMrzNameTokenNoise(token) {
  if (/^[KL][A-Z]{5,}$/.test(token)) {
    return token.slice(1);
  }

  return token;
}

function fixMrzNameTokens(tokens) {
  return tokens.map(fixMrzNameTokenNoise).filter(Boolean);
}

function cleanNameCandidate(value) {
  const stopWords = new Set([
    "GIVEN",
    "NAME",
    "NAMES",
    "SURNAME",
    "LAST",
    "FIRST",
    "PASSPORT",
    "NATIONALITY",
    "REPUBLIC",
    "INDIA",
    "INDIAN",
    "DATE",
    "BIRTH",
    "SEX",
    "PLACE",
    "SIGNATURE"
  ]);
  const words = normalizeSpace(value)
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[-']+|[-']+$/g, ""))
    .filter((word) => /^[A-Za-z][A-Za-z'-]{1,24}$/.test(word))
    .filter((word) => !stopWords.has(word.toUpperCase()));

  return words.join(" ");
}

function isPlausibleName(value, { minWords = 1, strictRaw = false } = {}) {
  const raw = normalizeSpace(value);

  if (strictRaw && (/[0-9=~_()[\]{}|\\/:;,.!?<>]/.test(raw) || /\b[A-Za-z]\b/.test(raw))) {
    return false;
  }

  const cleaned = cleanNameCandidate(value);
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length >= minWords && words.length <= 6 && words.every((word) => word.length >= 2);
}

function isIndianPassportText(text, lines) {
  const normalized = normalizeOcrText(text).toUpperCase();
  const nationality = getStrictLabelValue(lines, ["nationality"], { maxWords: 3 }).toUpperCase();

  return (
    /\bINDIAN\b/.test(nationality) ||
    /\bIND\b/.test(nationality) ||
    /\bNATIONALITY\s*[:：/-]?\s*(?:INDIAN|IND)\b/i.test(normalized) ||
    /\bREPUBLIC\s+OF\s+INDIA\b/i.test(normalized) ||
    /^P<IND/m.test(normalized)
  );
}

function parseMrz(text) {
  const rawLines = String(text || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<]/g, ""))
    .filter((line) => line.includes("<") && line.length >= 25);

  const firstIndex = rawLines.findIndex((line) => /^P[A-Z0-9<]/.test(line));
  const line1 = firstIndex >= 0 ? rawLines[firstIndex] : "";
  const line2 = firstIndex >= 0 ? rawLines[firstIndex + 1] || "" : "";

  if (!line1 || !line2) {
    return { worker_name: "", passport_number: "" };
  }

  const namePart = line1.slice(5).replace(/<+$/g, "");
  const [surnameRaw = "", givenRaw = ""] = namePart.split("<<");
  const surnameTokens = getMrzNameTokens(surnameRaw);
  const givenTokens = getMrzNameTokens(givenRaw);
  const fallbackTokens = getMrzNameTokens(namePart);
  const nameTokens =
    givenTokens.length && surnameTokens.length
      ? [...givenTokens, ...surnameTokens]
      : surnameTokens.length >= 2
        ? surnameTokens
        : fallbackTokens;
  const cleanedNameTokens = fixMrzNameTokens(nameTokens);
  const passportNumber = line2.slice(0, 9).replace(/</g, "").replace(/O/g, "0").trim();

  return {
    worker_name: normalizeSpace(cleanedNameTokens.join(" ")),
    passport_number: normalizePassportNumber(passportNumber)
  };
}

function parsePassportText(text) {
  const lines = getTextLines(text);
  const mrz = parseMrz(text);
  const isIndian = isIndianPassportText(text, lines);
  const passportNumber =
    mrz.passport_number ||
    normalizePassportNumber(
      getStrictLabelValue(lines, [
        "passport\\s*(?:no|number)",
        "passport\\s*#",
        "document\\s*(?:no|number)",
        "no\\."
      ], { maxWords: 2 })
    );

  const lastName = getStrictLabelValue(lines, ["last\\s*name", "surname", "family\\s*name"], { maxWords: 5 });
  const givenNames = getStrictLabelValue(lines, ["given\\s*name(?:s)?", "given\\s*names", "first\\s*name"], { maxWords: 8 });
  const rawLabeledName = [givenNames, lastName].filter(Boolean).join(" ");
  const labeledName = cleanNameCandidate(rawLabeledName);
  const rawFallbackName = getStrictLabelValue(lines, ["full\\s*name", "name"], { maxWords: 10 });
  const fallbackName = cleanNameCandidate(rawFallbackName);
  const fullName =
    (isIndian && isPlausibleName(rawLabeledName, { minWords: 2, strictRaw: true }) ? labeledName : "") ||
    mrz.worker_name ||
    (isPlausibleName(rawLabeledName, { strictRaw: true }) ? labeledName : "") ||
    (isPlausibleName(rawFallbackName, { minWords: 2, strictRaw: true }) ? fallbackName : "");

  return {
    worker_name: fullName,
    passport_number: passportNumber
  };
}

function parseLmiaText(text) {
  const lines = getTextLines(text);
  const fullText = lines.join("\n");
  const lmiaLabelValue = getLabelValue(lines, [
    "lmia\\s*(?:application\\s*)?(?:no|number)",
    "application\\s*(?:no|number)",
    "file\\s*(?:no|number)"
  ], { maxWords: 3 });
  const nearLmia = fullText.match(/LMIA[\s\S]{0,80}?([A-Z]?\d[\d -]{5,14})/i)?.[1] || "";
  const lmiaNumber = cleanDocumentValue(lmiaLabelValue || nearLmia).replace(/[^A-Z0-9-]/gi, "").toUpperCase();

  const legalBusinessName = getStrictLabelValue(lines, [
    "legal\\s*business\\s*name",
    "business\\s*legal\\s*name"
  ], { maxWords: 16 });

  const company = legalBusinessName || getStrictLabelValue(lines, [
    "employer\\s*name",
    "employer",
    "company\\s*name",
    "business\\s*name"
  ], { maxWords: 16 });

  const jobTitle = getStrictLabelValue(lines, [
    "job\\s*title\\s*/\\s*occupation",
    "job\\s*offer\\s*title",
    "job\\s*title"
  ], { maxWords: 12 });

  const position = jobTitle || getStrictLabelValue(lines, [
    "position",
    "occupation",
    "noc\\s*job\\s*title"
  ], { maxWords: 10 });

  return { lmia_number: lmiaNumber, company, position };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng", 1, {
      cachePath: ocrCacheDir,
      logger: () => {}
    });
  }

  return ocrWorkerPromise;
}

async function recognizeImage(buffer) {
  const run = async () => {
    const worker = await getOcrWorker();
    const result = await worker.recognize(buffer);
    return result.data.text || "";
  };

  const task = ocrQueue.then(run, run);
  ocrQueue = task.catch(() => {});
  return task;
}

async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

function hasUsefulPdfText(text, label) {
  const normalized = normalizeSpace(text);
  if (normalized.length < 60) return false;

  if (label === "Passport") {
    return /passport|given\s+name|surname|last\s+name|P<|nationality|date\s+of\s+birth/i.test(normalized);
  }

  if (label === "LMIA") {
    return /lmia|legal\s+business\s+name|job\s+title|employer|company|position/i.test(normalized);
  }

  return normalized.length >= 120;
}

async function extractPdfOcrText(buffer, firstPages = 2) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({
      first: firstPages,
      desiredWidth: 1600,
      imageDataUrl: false,
      imageBuffer: true
    });
    const pageBuffers = (result.pages || []).map((page) => page.data).filter(Boolean);
    const pageTexts = [];

    for (const pageBuffer of pageBuffers) {
      pageTexts.push(await recognizeImage(pageBuffer));
    }

    return pageTexts.join("\n");
  } finally {
    await parser.destroy();
  }
}

async function extractTextFromFile(file, warnings, label) {
  const mimetype = file.mimetype || "";

  if (mimetype.startsWith("image/")) {
    return recognizeImage(file.buffer);
  }

  if (mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf")) {
    const pdfText = await extractTextFromPdf(file.buffer);
    if (!hasUsefulPdfText(pdfText, label)) {
      const ocrText = await extractPdfOcrText(file.buffer, label === "LMIA" ? 3 : 1);
      if (normalizeSpace(ocrText).length < 20) {
        warnings.push(`${label} PDF text could not be read clearly.`);
      }
      return [pdfText, ocrText].filter(Boolean).join("\n");
    }
    return pdfText;
  }

  if (mimetype.startsWith("text/")) {
    return file.buffer.toString("utf8");
  }

  warnings.push(`${label} file type is not supported for extraction.`);
  return "";
}

function buildExtractedRecord({ passportText, lmiaText, warnings }) {
  const passport = parsePassportText(passportText);
  const lmia = parseLmiaText(lmiaText);
  const missingWarnings = [];

  if (!passport.worker_name) missingWarnings.push("Worker name was not found.");
  if (!passport.passport_number) missingWarnings.push("Passport number was not found.");
  if (!lmia.lmia_number) missingWarnings.push("LMIA number was not found.");
  if (!lmia.company) missingWarnings.push("Company name was not found.");
  if (!lmia.position) missingWarnings.push("Position was not found.");

  const allWarnings = [...warnings, ...missingWarnings];

  return {
    worker_name: passport.worker_name,
    passport_number: passport.passport_number,
    company: lmia.company,
    position: lmia.position,
    lmia_number: lmia.lmia_number,
    submitted: false,
    submission_date: "",
    decision: "Pending",
    agent: "",
    consultant: "",
    note: allWarnings.length ? `Extraction warnings: ${allWarnings.join("; ")}` : "",
    warnings: allWarnings
  };
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

app.get("/api/health", (req, res) => {
  console.log("Health check", {
    host: req.get("host"),
    time: new Date().toISOString()
  });
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
        OR IFNULL(w.passport_number, '') LIKE :search
        OR w.company LIKE :search
        OR IFNULL(w.position, '') LIKE :search
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
    const validationError = validateWorkerPayload(payload);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const result = await execute(
      `INSERT INTO workers (
        file_no, worker_name, passport_number, company, position, agent, consultant, submitted, submission_date, decision, lmia_number, note
      )
      VALUES (
        COALESCE(:fileNo, (SELECT COALESCE(MAX(file_no), 1999) + 1 FROM workers)),
        :workerName, :passportNumber, :company, :position, :agent, :consultant, :submitted, :submissionDate, :decision, :lmiaNumber, :note
      )`,
      {
        fileNo,
        ...payload
      }
    );

    const worker = await getWorkerById(Number(result.lastInsertRowid));

    res.status(201).json({ worker });
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
    const worker = await getWorkerById(id);

    if (!worker) {
      return res.status(404).json({ error: "Worker record not found." });
    }

    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

app.put("/api/workers/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const payload = getWorkerPayload(req.body);
    const validationError = validateWorkerPayload(payload);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const existing = await execute("SELECT id FROM workers WHERE id = :id LIMIT 1", { id });
    if (!existing.rows.length) {
      return res.status(404).json({ error: "Worker record not found." });
    }

    await execute(
      `UPDATE workers
       SET worker_name = :workerName,
           passport_number = :passportNumber,
           company = :company,
           position = :position,
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

    const updated = await getWorkerById(id);

    res.json({ worker: updated });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/workers/:id/documents",
  requireAuth,
  importUpload.fields([
    { name: "passport", maxCount: 1 },
    { name: "lmia", maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await execute("SELECT id FROM workers WHERE id = :id LIMIT 1", { id });

      if (!existing.rows.length) {
        return res.status(404).json({ error: "Worker record not found." });
      }

      const passport = req.files?.passport?.[0] || null;
      const lmia = req.files?.lmia?.[0] || null;

      if (!passport && !lmia) {
        return res.status(400).json({ error: "Choose a passport or LMIA document to save." });
      }

      const lmiaNumber = toNullableText(req.body.lmia_number);

      if (lmia && !lmiaNumber) {
        return res.status(400).json({ error: "LMIA number is required before saving the LMIA document." });
      }

      if (lmiaNumber && !isDigitsOnly(lmiaNumber)) {
        return res.status(400).json({ error: "LMIA number must contain digits only." });
      }

      const documents = await saveWorkerDocuments(id, {
        passport,
        lmia,
        passportNumber: toNullableText(req.body.passport_number),
        lmiaNumber
      });
      const worker = await getWorkerById(id);

      res.status(201).json({ worker, documents });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/import/extract",
  requireAuth,
  importUpload.fields([
    { name: "passport", maxCount: 1 },
    { name: "lmia", maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const passport = req.files?.passport?.[0];
      const lmia = req.files?.lmia?.[0];

      if (!passport || !lmia) {
        return res.status(400).json({ error: "Upload both a passport and an LMIA document." });
      }

      const warnings = [];
      const [passportText, lmiaText] = await Promise.all([
        extractTextFromFile(passport, warnings, "Passport"),
        extractTextFromFile(lmia, warnings, "LMIA")
      ]);

      res.json({
        record: buildExtractedRecord({ passportText, lmiaText, warnings })
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/import/confirm",
  requireAuth,
  importUpload.fields([
    { name: "passport", maxCount: 1 },
    { name: "lmia", maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const passport = req.files?.passport?.[0];
      const lmia = req.files?.lmia?.[0];

      if (!passport || !lmia) {
        return res.status(400).json({ error: "Upload both a passport and an LMIA document." });
      }

      let record;
      try {
        record = JSON.parse(req.body.record || "{}");
      } catch {
        return res.status(400).json({ error: "Import review data is invalid." });
      }

      const payload = getWorkerPayload(record);
      const fileNo = getFileNumber(record.file_no);
      const validationError = validateWorkerPayload(payload);

      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      if (!payload.lmiaNumber) {
        return res.status(400).json({ error: "LMIA number is required before saving the LMIA document." });
      }

      const result = await execute(
        `INSERT INTO workers (
          file_no, worker_name, passport_number, company, position, agent, consultant, submitted, submission_date, decision, lmia_number, note
        )
        VALUES (
          COALESCE(:fileNo, (SELECT COALESCE(MAX(file_no), 1999) + 1 FROM workers)),
          :workerName, :passportNumber, :company, :position, :agent, :consultant, :submitted, :submissionDate, :decision, :lmiaNumber, :note
        )`,
        {
          fileNo,
          ...payload
        }
      );

      const workerId = Number(result.lastInsertRowid);
      let documents;

      try {
        documents = await saveImportDocuments(workerId, {
          passport,
          lmia,
          passportNumber: payload.passportNumber,
          lmiaNumber: payload.lmiaNumber
        });
      } catch (saveError) {
        await execute("DELETE FROM workers WHERE id = :workerId", { workerId }).catch(() => {});
        throw saveError;
      }

      const worker = await getWorkerById(workerId);

      res.status(201).json({ worker, documents });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        return res.status(409).json({ error: "That file number already exists." });
      }
      next(error);
    }
  }
);

app.get("/api/documents/:id/download", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await execute("SELECT * FROM documents WHERE id = :id LIMIT 1", { id });

    if (!result.rows.length) {
      return res.status(404).json({ error: "Document not found." });
    }

    const document = result.rows[0];
    const filePath = getStoredDocumentPath(document.stored_name);

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "Document file was not found on disk." });
    }

    res.download(filePath, document.original_name || document.stored_name);
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

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

async function configureFrontend() {
  if (devMode) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: rootDir,
      appType: "custom",
      server: {
        middlewareMode: true,
        proxy: {}
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

  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

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
