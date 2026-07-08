import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Search,
  Trash2,
  UploadCloud,
  XCircle
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "fwf-auth-token";
const emptyFiles = { passport: null, lmia: null };
const alphaWordsPattern = "[A-Za-z ]+";
const alphanumericWordsPattern = "[A-Za-z0-9 ]+";
const digitsPattern = "[0-9]+";
const alphaWordsRegex = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const alphanumericWordsRegex = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const digitsRegex = /^\d+$/;

const emptyForm = {
  worker_name: "",
  passport_number: "",
  company: "",
  position: "",
  agent: "",
  consultant: "",
  submitted: false,
  submission_date: "",
  decision: "Pending",
  lmia_number: "",
  note: ""
};

async function apiRequest(path, options = {}) {
  const { token, body, formData = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let requestBody = body;
  if (body !== undefined && !formData) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
    body: requestBody
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || response.statusText };
  }

  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function workerToForm(worker) {
  return {
    worker_name: worker.worker_name || "",
    passport_number: worker.passport_number || "",
    company: worker.company || "",
    position: worker.position || "",
    agent: worker.agent || "",
    consultant: worker.consultant || "",
    submitted: Boolean(worker.submitted),
    submission_date: worker.submission_date || "",
    decision: worker.decision || "Pending",
    lmia_number: worker.lmia_number || "",
    note: worker.note || ""
  };
}

function normalizeInputText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateWorkerFields(record, { requireLmiaNumber = false } = {}) {
  const workerName = normalizeInputText(record.worker_name);
  const company = normalizeInputText(record.company);
  const agent = normalizeInputText(record.agent);
  const consultant = normalizeInputText(record.consultant);
  const lmiaNumber = String(record.lmia_number || "").trim();

  if (!workerName) {
    return "Worker name is required.";
  }

  if (!alphaWordsRegex.test(workerName)) {
    return "Worker name must contain alphabets and spaces only.";
  }

  if (!company) {
    return "Company is required.";
  }

  if (!alphanumericWordsRegex.test(company)) {
    return "Company name must contain letters, numbers, and spaces only.";
  }

  if (agent && !alphaWordsRegex.test(agent)) {
    return "Agent must contain alphabets and spaces only.";
  }

  if (consultant && !alphaWordsRegex.test(consultant)) {
    return "Consultant must contain alphabets and spaces only.";
  }

  if (requireLmiaNumber && !lmiaNumber) {
    return "LMIA number is required before saving the LMIA document.";
  }

  if (lmiaNumber && !digitsRegex.test(lmiaNumber)) {
    return "LMIA number must contain digits only.";
  }

  return "";
}

function statusClasses(worker) {
  if (worker.submitted) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function decisionClasses(decision) {
  const normalized = (decision || "").toLowerCase();
  if (normalized.includes("approved")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized.includes("refused") || normalized.includes("denied")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized.includes("withdrawn")) {
    return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);

  function handleLogin(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
  }

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return <Dashboard token={token} user={user} setUser={setUser} onLogout={handleLogout} />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: { email, password }
      });
      onLogin(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-zinc-900">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <form
          onSubmit={submit}
          className="w-full rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-6">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-md bg-teal-700 text-white">
              <FileText className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-semibold text-zinc-950">Foreign Worker Files</h1>
            <p className="mt-2 text-sm text-zinc-600">Sign in to manage worker records.</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="field-label">Email</span>
              <input
                className="control"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@fwf.local"
                required
              />
            </label>

            <label className="block">
              <span className="field-label">Password</span>
              <input
                className="control"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
          </div>

          {error ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button className="primary-button mt-6 w-full" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ token, user, setUser, onLogout }) {
  const [workers, setWorkers] = useState([]);
  const [activeWorker, setActiveWorker] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [isNew, setIsNew] = useState(true);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState(null);
  const [loadingWorkers, setLoadingWorkers] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [manualFiles, setManualFiles] = useState(emptyFiles);
  const [importFiles, setImportFiles] = useState(emptyFiles);
  const [importRecord, setImportRecord] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);

  const stats = useMemo(() => {
    const submitted = workers.filter((worker) => worker.submitted).length;
    const pending = workers.filter((worker) => !worker.decision || worker.decision === "Pending").length;
    return { total: workers.length, submitted, pending };
  }, [workers]);

  useEffect(() => {
    apiRequest("/api/auth/me", { token })
      .then((data) => setUser(data.user))
      .catch((error) => {
        if (error.status === 401) {
          onLogout();
        }
      });
  }, [onLogout, setUser, token]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLoadingWorkers(true);
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : "";
        const data = await apiRequest(`/api/workers${query}`, { token });
        if (!cancelled) {
          setWorkers(data.workers);
        }
      } catch (error) {
        if (!cancelled) {
          handleError(error);
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkers(false);
        }
      }
    }, search ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [search, token]);

  function handleError(error) {
    if (error.status === 401) {
      onLogout();
      return;
    }
    setNotice({ type: "error", text: error.message });
  }

  async function refreshWorkers() {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const data = await apiRequest(`/api/workers${query}`, { token });
    setWorkers(data.workers);
  }

  async function openWorker(id, { clearNotice = true } = {}) {
    if (clearNotice) {
      setNotice(null);
    }
    setLoadingDetail(true);
    setIsNew(false);
    setManualFiles(emptyFiles);
    setMobileEditorOpen(true);

    try {
      const data = await apiRequest(`/api/workers/${id}`, { token });
      setActiveWorker(data.worker);
      setForm(workerToForm(data.worker));
    } catch (error) {
      handleError(error);
    } finally {
      setLoadingDetail(false);
    }
  }

  function startNew({ clearNotice = true } = {}) {
    if (clearNotice) {
      setNotice(null);
    }
    setCreateOpen(false);
    setActiveWorker(null);
    setForm(emptyForm);
    setManualFiles(emptyFiles);
    setIsNew(true);
    setMobileEditorOpen(true);
  }

  function openCreateOptions() {
    setNotice(null);
    setCreateOpen(true);
  }

  function closeCreateOptions() {
    setCreateOpen(false);
  }

  function startImport() {
    setNotice(null);
    setCreateOpen(false);
    setImportFiles(emptyFiles);
    setImportRecord(null);
    setImportOpen(true);
  }

  function closeImport() {
    setImportOpen(false);
    setExtracting(false);
    setConfirmingImport(false);
  }

  function closeEditor() {
    setMobileEditorOpen(false);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateImportField(field, value) {
    setImportRecord((current) => ({ ...current, [field]: value }));
  }

  async function extractImport(event) {
    event.preventDefault();

    if (!importFiles.passport || !importFiles.lmia) {
      setNotice({ type: "error", text: "Upload both a passport and an LMIA document." });
      return;
    }

    const payload = new FormData();
    payload.append("passport", importFiles.passport);
    payload.append("lmia", importFiles.lmia);
    setNotice(null);
    setExtracting(true);

    try {
      const data = await apiRequest("/api/import/extract", {
        method: "POST",
        token,
        body: payload,
        formData: true
      });
      setImportRecord(data.record);
    } catch (error) {
      handleError(error);
    } finally {
      setExtracting(false);
    }
  }

  async function confirmImport() {
    const validationError = validateWorkerFields(importRecord || {}, { requireLmiaNumber: true });

    if (validationError) {
      setNotice({ type: "error", text: validationError });
      return;
    }

    if (!importFiles.passport || !importFiles.lmia) {
      setNotice({ type: "error", text: "Upload both a passport and an LMIA document." });
      return;
    }

    const payload = new FormData();
    payload.append("record", JSON.stringify(importRecord));
    payload.append("passport", importFiles.passport);
    payload.append("lmia", importFiles.lmia);

    setConfirmingImport(true);
    setNotice(null);

    try {
      const data = await apiRequest("/api/import/confirm", {
        method: "POST",
        token,
        body: payload,
        formData: true
      });
      const lmiaReused = data.documents?.some((document) => document.document_type === "lmia" && document.reused);
      setImportOpen(false);
      setNotice({
        type: "success",
        text: lmiaReused
          ? "Imported worker file created. Passport saved and existing LMIA document reused."
          : "Imported worker file created. Passport and LMIA documents saved."
      });
      await refreshWorkers();
      await openWorker(data.worker.id, { clearNotice: false });
    } catch (error) {
      handleError(error);
    } finally {
      setConfirmingImport(false);
    }
  }

  async function downloadDocument(document) {
    try {
      const response = await fetch(`${API_BASE}/api/documents/${document.id}/download`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Document download failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.original_name || "document";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error);
    }
  }

  async function uploadManualDocuments(workerId) {
    if (!manualFiles.passport && !manualFiles.lmia) {
      return null;
    }

    const payload = new FormData();
    payload.append("passport_number", form.passport_number || "");
    payload.append("lmia_number", form.lmia_number || "");

    if (manualFiles.passport) {
      payload.append("passport", manualFiles.passport);
    }

    if (manualFiles.lmia) {
      payload.append("lmia", manualFiles.lmia);
    }

    return apiRequest(`/api/workers/${workerId}/documents`, {
      method: "POST",
      token,
      body: payload,
      formData: true
    });
  }

  async function saveWorker(event) {
    event.preventDefault();
    const validationError = validateWorkerFields(form, { requireLmiaNumber: Boolean(manualFiles.lmia) });

    if (validationError) {
      setNotice({ type: "error", text: validationError });
      return;
    }

    setNotice(null);
    setSaving(true);

    try {
      const data = await apiRequest(isNew ? "/api/workers" : `/api/workers/${activeWorker.id}`, {
        method: isNew ? "POST" : "PUT",
        token,
        body: form
      });

      let savedWorker = data.worker;
      let successText = isNew ? "Worker file created." : "Worker file updated.";

      if (manualFiles.passport || manualFiles.lmia) {
        try {
          const documentData = await uploadManualDocuments(data.worker.id);
          const lmiaReused = documentData?.documents?.some((document) => document.document_type === "lmia" && document.reused);
          savedWorker = documentData?.worker || data.worker;
          setManualFiles(emptyFiles);
          successText = lmiaReused
            ? `${successText} Documents saved and existing LMIA reused.`
            : `${successText} Documents saved.`;
        } catch (documentError) {
          setNotice({ type: "error", text: `${successText} Documents were not saved: ${documentError.message}` });
          await refreshWorkers();
          await openWorker(data.worker.id, { clearNotice: false });
          return;
        }
      }

      setNotice({ type: "success", text: successText });
      await refreshWorkers();
      await openWorker(savedWorker.id, { clearNotice: false });
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  }

  async function deleteWorker() {
    if (!activeWorker || !window.confirm(`Delete file ${activeWorker.file_no}?`)) {
      return;
    }

    setNotice(null);

    try {
      await apiRequest(`/api/workers/${activeWorker.id}`, {
        method: "DELETE",
        token
      });
      setNotice({ type: "success", text: "Worker file deleted." });
      startNew({ clearNotice: false });
      setMobileEditorOpen(false);
      await refreshWorkers();
    } catch (error) {
      handleError(error);
    }
  }

  const passportDocument = isNew ? null : getDocumentByType(activeWorker?.documents, "passport");
  const lmiaDocument = isNew ? null : getDocumentByType(activeWorker?.documents, "lmia");

  return (
    <div className="min-h-dvh bg-neutral-100 text-zinc-900 lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur lg:shrink-0">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div>
            <p className="text-xs font-medium uppercase text-teal-700">File registry</p>
            <h1 className="text-xl font-semibold text-zinc-950 sm:text-2xl">Foreign Worker Files</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 text-right text-sm sm:block">
              {/* <p className="truncate font-medium text-zinc-900">{user?.name || "Administrator"}</p>
              <p className="truncate text-zinc-500">{user?.email || ""}</p> */}
            </div>
            <button className="icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={onLogout}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="grid w-full gap-5 px-3 pb-24 pt-4 sm:px-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_520px] lg:overflow-hidden lg:px-6 lg:pb-6 lg:pt-6 xl:grid-cols-[minmax(0,1fr)_560px]">
        <section className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Files" value={stats.total} />
              <Stat label="Submitted" value={stats.submitted} />
              <Stat label="Pending" value={stats.pending} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-0 sm:w-72">
                <span className="sr-only">Search files</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-base outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 sm:h-9 sm:text-sm"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search files"
                />
              </label>
              {/* <button className="text-button hidden sm:inline-flex" type="button" onClick={startImport}>
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
                Import
              </button> */}
              <button className="primary-button hidden sm:inline-flex" type="button" onClick={openCreateOptions}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New file
              </button>
            </div>
          </div>

          {notice && !mobileEditorOpen ? (
            <div className="lg:hidden">
              <Notice notice={notice} />
            </div>
          ) : null}

          <WorkerList
            workers={workers}
            activeWorker={activeWorker}
            loading={loadingWorkers}
            onOpen={openWorker}
          />
        </section>

        <div className="fixed bottom-5 left-3 right-3 z-20 grid grid-cols-[1fr_auto] gap-2 sm:hidden">
          <button className="primary-button shadow-lg shadow-teal-900/20" type="button" onClick={startImport}>
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            Import
          </button>
          <button
            className="inline-flex h-11 w-14 items-center justify-center rounded-md bg-teal-700 text-white shadow-lg shadow-teal-900/20 transition hover:bg-teal-800"
            type="button"
            title="New file"
            aria-label="New file"
            onClick={openCreateOptions}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <aside
          className={`min-w-0 bg-neutral-100 ${
            mobileEditorOpen ? "fixed inset-0 z-40 block overflow-y-auto" : "hidden"
          } lg:static lg:z-auto lg:block lg:h-full lg:overflow-y-auto lg:rounded-lg lg:border lg:border-zinc-200 lg:bg-white lg:shadow-sm`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-3 lg:hidden">
            <button className="icon-button" type="button" title="Back" aria-label="Back" onClick={closeEditor}>
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 px-3 text-center">
              <p className="truncate text-sm font-bold text-zinc-950">
                {isNew ? "New file" : form.worker_name || `File ${activeWorker?.file_no || ""}`}
              </p>
              <p className="text-xs text-zinc-500">{isNew ? "Auto from 2000" : `File ${activeWorker?.file_no || ""}`}</p>
            </div>
            <div className="h-11 w-11" aria-hidden="true" />
          </div>

          <form onSubmit={saveWorker} className="min-h-dvh bg-white p-4 lg:min-h-0 lg:border-b lg:border-zinc-200">
            {/* <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">File no</p>
                <h2 className="text-xl font-semibold text-zinc-950">
                  {isNew ? "Auto from 2000" : activeWorker?.file_no}
                </h2>
              </div>
              {loadingDetail ? (
                <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-teal-700" aria-hidden="true" />
              ) : null}
            </div> */}

            {notice ? <Notice notice={notice} /> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Worker name</span>
                <input
                  className="control"
                  value={form.worker_name}
                  onChange={(event) => updateField("worker_name", event.target.value)}
                  pattern={alphaWordsPattern}
                  title="Use alphabets and spaces only."
                  required
                />
              </label>

              <label className="block">
                <span className="field-label">Passport number</span>
                <input
                  className="control"
                  value={form.passport_number}
                  onChange={(event) => updateField("passport_number", event.target.value)}
                />
              </label>

              <label className="block">
                <span className="field-label">Company</span>
                <input
                  className="control"
                  value={form.company}
                  onChange={(event) => updateField("company", event.target.value)}
                  pattern={alphanumericWordsPattern}
                  title="Use letters, numbers, and spaces only."
                  required
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="field-label">Position</span>
                <input
                  className="control"
                  value={form.position}
                  onChange={(event) => updateField("position", event.target.value)}
                />
              </label>

              <label className="block">
                <span className="field-label">Agent</span>
                <input
                  className="control"
                  value={form.agent}
                  onChange={(event) => updateField("agent", event.target.value)}
                  pattern={alphaWordsPattern}
                  title="Use alphabets and spaces only."
                />
              </label>

              <label className="block">
                <span className="field-label">Consultant</span>
                <input
                  className="control"
                  value={form.consultant}
                  onChange={(event) => updateField("consultant", event.target.value)}
                  pattern={alphaWordsPattern}
                  title="Use alphabets and spaces only."
                />
              </label>

              <label className="block">
                <span className="field-label">Submission date</span>
                <input
                  className="control"
                  type="date"
                  value={form.submission_date}
                  onChange={(event) => updateField("submission_date", event.target.value)}
                />
              </label>

              <label className="block">
                <span className="field-label">Decision</span>
                <select
                  className="control"
                  value={form.decision}
                  onChange={(event) => updateField("decision", event.target.value)}
                >
                  <option>Pending</option>
                  <option>In review</option>
                  <option>Approved</option>
                  <option>Refused</option>
                  <option>Withdrawn</option>
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="field-label">LMIA number</span>
                <input
                  className="control"
                  value={form.lmia_number}
                  onChange={(event) => updateField("lmia_number", event.target.value)}
                  inputMode="numeric"
                  pattern={digitsPattern}
                  title="Use digits only."
                />
              </label>

              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                <DocumentSlot
                  label="Passport document"
                  document={passportDocument}
                  file={manualFiles.passport}
                  accept="image/*,.pdf,application/pdf"
                  onChange={(file) => setManualFiles((current) => ({ ...current, passport: file }))}
                  onDownload={downloadDocument}
                />
                <DocumentSlot
                  label="LMIA document"
                  document={lmiaDocument}
                  file={manualFiles.lmia}
                  accept="image/*,.pdf,application/pdf"
                  onChange={(file) => setManualFiles((current) => ({ ...current, lmia: file }))}
                  onDownload={downloadDocument}
                />
              </div>

              <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-3 sm:col-span-2">
                <span>
                  <span className="block text-sm font-medium text-zinc-900">Submitted</span>
                  <span className="block text-xs text-zinc-500">{form.submitted ? "Yes" : "No"}</span>
                </span>
                <input
                  className="h-5 w-5 accent-teal-700"
                  type="checkbox"
                  checked={form.submitted}
                  onChange={(event) => updateField("submitted", event.target.checked)}
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="field-label">Note</span>
                <textarea
                  className="control min-h-28 resize-y"
                  value={form.note}
                  onChange={(event) => updateField("note", event.target.value)}
                />
              </label>

            </div>

            <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-2 border-t border-zinc-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-between lg:static lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-0">
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save
              </button>
              {!isNew ? (
                <button className="danger-button" type="button" onClick={deleteWorker}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </button>
              ) : null}
            </div>
          </form>

        </aside>
      </main>

      {createOpen ? (
        <CreateFilePanel
          onClose={closeCreateOptions}
          onImport={startImport}
          onManual={() => startNew({ clearNotice: false })}
        />
      ) : null}

      {importOpen ? (
        <ImportPanel
          files={importFiles}
          record={importRecord}
          extracting={extracting}
          confirming={confirmingImport}
          notice={notice}
          onClose={closeImport}
          onFileChange={(field, file) => setImportFiles((current) => ({ ...current, [field]: file }))}
          onExtract={extractImport}
          onRecordChange={updateImportField}
          onConfirm={confirmImport}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function Notice({ notice }) {
  const isSuccess = notice.type === "success";
  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {isSuccess ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{notice.text}</span>
    </div>
  );
}

function CreateFilePanel({ onClose, onImport, onManual }) {
  return (
    <div className="fixed inset-0 z-50 bg-neutral-100 text-zinc-900 lg:bg-zinc-950/30 lg:p-6">
      <section className="mx-auto flex h-dvh max-w-md flex-col bg-white shadow-xl lg:h-auto lg:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-3">
          <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 px-3 text-center">
            <p className="truncate text-sm font-bold text-zinc-950">New file</p>
            <p className="text-xs text-zinc-500">Worker record</p>
          </div>
          <div className="h-11 w-11" aria-hidden="true" />
        </div>

        <div className="flex-1 space-y-3 p-4">
          <button
            className="flex w-full items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-4 text-left transition hover:border-teal-300 hover:bg-teal-100 active:scale-[0.99]"
            type="button"
            onClick={onImport}
          >
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white">
              <UploadCloud className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-zinc-950">Upload Passport + LMIA</span>
            </span>
          </button>

          <button
            className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 text-left transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.99]"
            type="button"
            onClick={onManual}
          >
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-neutral-50 text-zinc-700">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-zinc-950">Manual entry</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportPanel({
  files,
  record,
  extracting,
  confirming,
  notice,
  onClose,
  onFileChange,
  onExtract,
  onRecordChange,
  onConfirm
}) {
  return (
    <div className="fixed inset-0 z-50 bg-neutral-100 text-zinc-900 lg:bg-zinc-950/30 lg:p-6">
      <section className="mx-auto flex h-dvh max-w-2xl flex-col bg-white shadow-xl lg:h-auto lg:max-h-[calc(100vh-3rem)] lg:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-3">
          <button className="icon-button" type="button" title="Close" aria-label="Close import" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 px-3 text-center">
            <p className="truncate text-sm font-bold text-zinc-950">Import worker file</p>
            <p className="text-xs text-zinc-500">{record ? "Review extracted fields" : "Local OCR import"}</p>
          </div>
          <div className="h-11 w-11" aria-hidden="true" />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {notice ? <Notice notice={notice} /> : null}

          {!record ? (
            <form className="space-y-4" onSubmit={onExtract}>
              <FilePicker
                label="Passport"
                file={files.passport}
                accept="image/*,.pdf,application/pdf"
                onChange={(file) => onFileChange("passport", file)}
              />
              <FilePicker
                label="LMIA document"
                file={files.lmia}
                accept="image/*,.pdf,application/pdf"
                onChange={(file) => onFileChange("lmia", file)}
              />
              <button className="primary-button w-full" type="submit" disabled={extracting}>
                {extracting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
                Extract
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {record.warnings?.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {record.warnings.join(" ")}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <ReviewInput
                  label="Worker name"
                  value={record.worker_name}
                  onChange={(value) => onRecordChange("worker_name", value)}
                  pattern={alphaWordsPattern}
                  title="Use alphabets and spaces only."
                  required
                />
                <ReviewInput label="Passport number" value={record.passport_number} onChange={(value) => onRecordChange("passport_number", value)} />
                <ReviewInput
                  label="LMIA number"
                  value={record.lmia_number}
                  onChange={(value) => onRecordChange("lmia_number", value)}
                  inputMode="numeric"
                  pattern={digitsPattern}
                  title="Use digits only."
                />
                <ReviewInput
                  label="Company"
                  value={record.company}
                  onChange={(value) => onRecordChange("company", value)}
                  pattern={alphanumericWordsPattern}
                  title="Use letters, numbers, and spaces only."
                  required
                />
                <ReviewInput label="Position" value={record.position} onChange={(value) => onRecordChange("position", value)} />
                <label className="block sm:col-span-2">
                  <span className="field-label">Note</span>
                  <textarea
                    className="control min-h-24 resize-y"
                    value={record.note || ""}
                    onChange={(event) => onRecordChange("note", event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {record ? (
          <div className="sticky bottom-0 grid gap-2 border-t border-zinc-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:grid-cols-2">
            <button className="text-button" type="button" onClick={onExtract} disabled={extracting || confirming}>
              {extracting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
              Re-extract
            </button>
            <button className="primary-button" type="button" onClick={onConfirm} disabled={confirming}>
              {confirming ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              Confirm
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FilePicker({ label, file, accept, onChange }) {
  return (
    <label className="block rounded-lg border border-zinc-200 bg-neutral-50 p-4">
      <span className="field-label">{label}</span>
      <input
        key={file?.name || "empty"}
        className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-teal-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      <span className="mt-2 block truncate text-sm text-zinc-600">{file?.name || "No file selected"}</span>
    </label>
  );
}

function ReviewInput({ label, value, onChange, required = false, pattern, inputMode, title }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        className="control"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        pattern={pattern}
        inputMode={inputMode}
        title={title}
      />
    </label>
  );
}

function formatFileSize(size) {
  const value = Number(size || 0);

  if (!value) {
    return "";
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getDocumentByType(documents, documentType) {
  return (documents || []).find((document) => document.document_type === documentType) || null;
}

function DocumentSlot({ label, document, file, accept, onChange, onDownload }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-neutral-50 p-3">
      <div className="flex items-start gap-3">
        <FileText className="mt-1 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="field-label">{label}</p>
          <p className="truncate text-sm font-medium text-zinc-900">
            {document?.original_name || file?.name || "No file selected"}
          </p>
          {document ? (
            <p className="truncate text-xs text-zinc-500">{formatFileSize(document.size) || "Saved"}</p>
          ) : null}
        </div>
        {document ? (
          <button
            className="icon-button shrink-0"
            type="button"
            title={`Download ${label}`}
            aria-label={`Download ${label}`}
            onClick={() => onDownload(document)}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {file && document ? <p className="mt-2 truncate text-xs text-zinc-600">Selected: {file.name}</p> : null}

      <label className="text-button mt-3 w-full cursor-pointer">
        <UploadCloud className="h-4 w-4" aria-hidden="true" />
        {document ? "Replace" : "Upload"}
        <input
          key={file?.name || "empty"}
          className="sr-only"
          type="file"
          accept={accept}
          onChange={(event) => onChange(event.target.files?.[0] || null)}
        />
      </label>
    </div>
  );
}

function WorkerList({ workers, activeWorker, loading, onOpen }) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-zinc-200 bg-white">
        <LoaderCircle className="h-6 w-6 animate-spin text-teal-700" aria-hidden="true" />
      </div>
    );
  }

  if (!workers.length) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <FileText className="mx-auto h-8 w-8 text-zinc-400" aria-hidden="true" />
        <p className="mt-3 font-medium text-zinc-900">No worker files found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden rounded-lg border border-zinc-200 bg-white shadow-sm lg:block lg:flex-1 lg:overflow-auto">
        <table className="w-full min-w-[1120px] divide-y divide-zinc-200 text-sm">
          <thead className="sticky top-0 z-10 bg-neutral-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">File no</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Passport</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Decision</th>
              <th className="px-4 py-3">LMIA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {workers.map((worker) => (
              <tr
                key={worker.id}
                className={`cursor-pointer transition hover:bg-teal-50/60 ${
                  activeWorker?.id === worker.id ? "bg-teal-50" : "bg-white"
                }`}
                onClick={() => onOpen(worker.id)}
              >
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-zinc-950">{worker.file_no}</td>
                <td className="min-w-48 max-w-72 px-4 py-3">
                  <p className="truncate font-medium text-zinc-900">{worker.worker_name || "-"}</p>
                  <p className="truncate text-xs text-zinc-500">{worker.consultant || "No consultant"}</p>
                </td>
                <td className="max-w-36 truncate px-4 py-3 text-zinc-700">{worker.passport_number || "-"}</td>
                <td className="min-w-56 max-w-96 truncate px-4 py-3 text-zinc-700">{worker.company}</td>
                <td className="min-w-44 max-w-72 truncate px-4 py-3 text-zinc-700">{worker.position || "-"}</td>
                <td className="max-w-40 truncate px-4 py-3 text-zinc-700">{worker.agent || "-"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusClasses(worker)}`}>
                    {worker.submitted ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${decisionClasses(worker.decision)}`}>
                    {worker.decision || "Pending"}
                  </span>
                </td>
                <td className="max-w-36 truncate px-4 py-3 text-zinc-700">{worker.lmia_number || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {workers.map((worker) => (
          <button
            key={worker.id}
            className={`w-full rounded-lg border p-4 text-left shadow-sm transition active:scale-[0.99] ${
              activeWorker?.id === worker.id ? "border-teal-300 bg-teal-50" : "border-zinc-200 bg-white"
            }`}
            type="button"
            onClick={() => onOpen(worker.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-zinc-500">File {worker.file_no}</p>
                <p className="truncate text-lg font-semibold text-zinc-950">{worker.worker_name || "-"}</p>
                <p className="truncate text-sm text-zinc-600">{worker.company}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusClasses(worker)}`}>
                  {worker.submitted ? "Submitted" : "Open"}
                </span>
                <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-600">
              <p className="truncate">Passport: {worker.passport_number || "-"}</p>
              <p className="truncate">Position: {worker.position || "-"}</p>
              <p className="truncate">Company: {worker.company || "-"}</p>
              <p className="truncate">LMIA: {worker.lmia_number || "-"}</p>
              <p className="truncate">Decision: {worker.decision || "Pending"}</p>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
