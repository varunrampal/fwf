import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Search,
  Trash2,
  XCircle
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "fwf-auth-token";

const emptyForm = {
  worker_name: "",
  company: "",
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
    company: worker.company || "",
    agent: worker.agent || "",
    consultant: worker.consultant || "",
    submitted: Boolean(worker.submitted),
    submission_date: worker.submission_date || "",
    decision: worker.decision || "Pending",
    lmia_number: worker.lmia_number || "",
    note: worker.note || ""
  };
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
    setActiveWorker(null);
    setForm(emptyForm);
    setIsNew(true);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveWorker(event) {
    event.preventDefault();
    setNotice(null);
    setSaving(true);

    try {
      const data = await apiRequest(isNew ? "/api/workers" : `/api/workers/${activeWorker.id}`, {
        method: isNew ? "POST" : "PUT",
        token,
        body: form
      });

      setNotice({ type: "success", text: isNew ? "Worker file created." : "Worker file updated." });
      await refreshWorkers();
      await openWorker(data.worker.id, { clearNotice: false });
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
      await refreshWorkers();
    } catch (error) {
      handleError(error);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-teal-700">File registry</p>
            <h1 className="text-2xl font-semibold text-zinc-950">Foreign Worker Files</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 text-right text-sm">
              <p className="truncate font-medium text-zinc-900">{user?.name || "Administrator"}</p>
              <p className="truncate text-zinc-500">{user?.email || ""}</p>
            </div>
            <button className="icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={onLogout}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Files" value={stats.total} />
              <Stat label="Submitted" value={stats.submitted} />
              <Stat label="Pending" value={stats.pending} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-0 sm:w-72">
                <span className="sr-only">Search files</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search files"
                />
              </label>
              <button className="primary-button" type="button" onClick={startNew}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New file
              </button>
            </div>
          </div>

          <WorkerList
            workers={workers}
            activeWorker={activeWorker}
            loading={loadingWorkers}
            onOpen={openWorker}
          />
        </section>

        <aside className="min-w-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <form onSubmit={saveWorker} className="border-b border-zinc-200 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">File no</p>
                <h2 className="text-xl font-semibold text-zinc-950">
                  {isNew ? "2000" : activeWorker?.file_no}
                </h2>
              </div>
              {loadingDetail ? (
                <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-teal-700" aria-hidden="true" />
              ) : null}
            </div>

            {notice ? <Notice notice={notice} /> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Worker name</span>
                <input
                  className="control"
                  value={form.worker_name}
                  onChange={(event) => updateField("worker_name", event.target.value)}
                  required
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="field-label">Company</span>
                <input
                  className="control"
                  value={form.company}
                  onChange={(event) => updateField("company", event.target.value)}
                  required
                />
              </label>

              <label className="block">
                <span className="field-label">Agent</span>
                <input
                  className="control"
                  value={form.agent}
                  onChange={(event) => updateField("agent", event.target.value)}
                />
              </label>

              <label className="block">
                <span className="field-label">Consultant</span>
                <input
                  className="control"
                  value={form.consultant}
                  onChange={(event) => updateField("consultant", event.target.value)}
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
                />
              </label>

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

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
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
      <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">File no</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Company</th>
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
                <td className="max-w-52 px-4 py-3">
                  <p className="truncate font-medium text-zinc-900">{worker.worker_name || "-"}</p>
                  <p className="truncate text-xs text-zinc-500">{worker.consultant || "No consultant"}</p>
                </td>
                <td className="max-w-48 truncate px-4 py-3 text-zinc-700">{worker.company}</td>
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

      <div className="space-y-3 md:hidden">
        {workers.map((worker) => (
          <button
            key={worker.id}
            className={`w-full rounded-lg border p-4 text-left shadow-sm transition ${
              activeWorker?.id === worker.id ? "border-teal-300 bg-teal-50" : "border-zinc-200 bg-white"
            }`}
            type="button"
            onClick={() => onOpen(worker.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-zinc-500">File {worker.file_no}</p>
                <p className="truncate font-semibold text-zinc-950">{worker.worker_name || "-"}</p>
                <p className="truncate text-sm text-zinc-600">{worker.company}</p>
              </div>
              <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${statusClasses(worker)}`}>
                {worker.submitted ? "Submitted" : "Open"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-600">
              <p className="truncate">Agent: {worker.agent || "-"}</p>
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
