/**
 * EchoClass AI — API client.
 * One place that knows the REST contract of apps/backend (see docs/API_DOCUMENTATION.md).
 * - Same-origin by default ('/api'); set VITE_API_BASE_URL (e.g. https://api.example.com/api) only when the API is on another origin.
 * - Every request carries the JWT in the Authorization header, including file downloads (a plain <a href> cannot do that).
 */
export const TOKEN_KEY = 'echoclass_token';
export const USER_KEY = 'echoclass_user';
export const UNAUTHORIZED_EVENT = 'echoclass:unauthorized';

const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = data.code;
    this.fields = data.fields || {};
  }
}

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

/** ws(s):// base for the live socket. Derived from the API base when that is an absolute URL, else from the page origin. */
export function wsBaseUrl() {
  const explicit = import.meta.env?.VITE_WS_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  try {
    const u = new URL(API_BASE, window.location.origin);
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  }
}

async function send(endpoint, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const token = getToken();
  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('Cannot reach the EchoClass server. Check your connection and that the server is running.', 0);
  }
  return response;
}

async function request(endpoint, options = {}) {
  const response = await send(endpoint, options);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const message = (data && typeof data === 'object' && data.error) || (typeof data === 'string' && data.slice(0, 200)) || `Request failed (${response.status})`;
    // A rejected token (expired / signed out elsewhere) ends the local session everywhere in the app.
    if (response.status === 401 && getToken() && options.auth !== false) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(message, response.status, typeof data === 'object' ? data : {});
  }
  return data;
}

/** Authenticated file download: fetch with the JWT, then hand the blob to the browser. */
export async function downloadFile(endpoint, fallbackName = 'download') {
  const response = await send(endpoint);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && getToken()) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(data.error || `Download failed (${response.status})`, response.status, data);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // ---- public ----
  getConfig: () => request('/config', { auth: false }),

  // ---- auth / account ----
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload, auth: false }),
  getMe: () => request('/me'),
  changePassword: (currentPassword, newPassword) => request('/me/password', { method: 'PATCH', body: { currentPassword, newPassword } }),
  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  deleteAccount: (password) => request('/me', { method: 'DELETE', body: { password } }),

  // ---- dashboard / classrooms ----
  getDashboard: () => request('/dashboard'),
  getClassrooms: () => request('/classrooms'),
  createClassroom: ({ name, subject = '', language = 'en-IN' }) => request('/classrooms', { method: 'POST', body: { name, subject, language } }),
  getClassroom: (id) => request(`/classrooms/${id}`),
  updateClassroom: (id, patch) => request(`/classrooms/${id}`, { method: 'PATCH', body: patch }),
  joinClassroom: (code) => request('/classrooms/join', { method: 'POST', body: { code } }),
  rotateJoinCode: (id) => request(`/classrooms/${id}/rotate-code`, { method: 'POST' }),
  deleteClassroom: (id) => request(`/classrooms/${id}`, { method: 'DELETE' }),
  leaveClassroom: (id) => request(`/classrooms/${id}/membership`, { method: 'DELETE' }),
  removeStudent: (id, userId) => request(`/classrooms/${id}/students/${userId}`, { method: 'DELETE' }),

  // ---- vocabulary (server returns the full updated list) ----
  addVocab: (classroomId, heard, replacement) => request(`/classrooms/${classroomId}/vocab`, { method: 'POST', body: { heard, replacement } }),
  deleteVocab: (classroomId, vocabId) => request(`/classrooms/${classroomId}/vocab/${vocabId}`, { method: 'DELETE' }),

  // ---- lectures (sessions) & captions ----
  listSessions: (classroomId, { page = 1, pageSize = 10, q = '' } = {}) => request(`/classrooms/${classroomId}/sessions${qs({ page, pageSize, q })}`),
  searchClassroom: (classroomId, q, page = 1) => request(`/classrooms/${classroomId}/search${qs({ q, page })}`),
  startSession: (classroomId, title) => request(`/classrooms/${classroomId}/sessions`, { method: 'POST', body: { title } }),
  endSession: (sessionId) => request(`/sessions/${sessionId}/end`, { method: 'POST' }),
  deleteSession: (sessionId) => request(`/sessions/${sessionId}`, { method: 'DELETE' }),
  getSession: (sessionId) => request(`/sessions/${sessionId}`),
  getCaptions: (sessionId, { after = 0, limit = 200, q = '' } = {}) => request(`/sessions/${sessionId}/captions${qs({ after, limit, q })}`),
  getWsTicket: (sessionId) => request(`/sessions/${sessionId}/ws-ticket`, { method: 'POST' }),
  exportTranscript: (sessionId, format = 'txt') => downloadFile(`/sessions/${sessionId}/export?format=${encodeURIComponent(format)}`, `transcript.${format}`),

  // ---- study notes (optional AI; teacher-only, consent required) ----
  getAiSummary: (sessionId) => request(`/sessions/${sessionId}/ai-summary`),
  generateAiSummary: (sessionId, { force = false } = {}) => request(`/sessions/${sessionId}/ai-summary`, { method: 'POST', body: { confirmExternal: true, force } }),

  // ---- system (teacher only) ----
  getNetwork: () => request('/system/network')
};
