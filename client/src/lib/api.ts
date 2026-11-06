import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { configureServerStatus, noteRequestEnd, noteRequestStart } from '@/lib/serverStatus.ts';

const rawApiUrl = import.meta.env.VITE_API_URL || '/api';
// Normalize so baseURL always ends with /api (handles both with and without trailing /api)
export const API_BASE_URL = rawApiUrl.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';

// Lets the app notice a sleeping server (see lib/serverStatus.ts).
configureServerStatus({ healthUrl: `${API_BASE_URL}/health` });

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Fired when the session can no longer be refreshed. AuthProvider listens for it. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

let isRefreshing = false;
let refreshSubscribers: { resolve: (token: string) => void; reject: (reason: unknown) => void }[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((s) => s.resolve(token));
  refreshSubscribers = [];
}

function onRefreshFailed(reason: unknown) {
  refreshSubscribers.forEach((s) => s.reject(reason));
  refreshSubscribers = [];
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  noteRequestStart(config);
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    noteRequestEnd(res.config, res.status);
    return res;
  },
  async (error: AxiosError) => {
    // No answer at all, or the host's 502/503/504 while the server starts, means "not awake yet".
    noteRequestEnd(error.config, error.response?.status, axios.isCancel(error));
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    const isAuthEndpoint = originalRequest.url?.includes('/auth/');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      // Each request is retried at most once, so a session that stays invalid cannot loop.
      originalRequest._retry = true;
      const retryWith = (token: string) => {
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
        }
        return api(originalRequest);
      };

      // Another request is already refreshing: wait for it, then retry with the new token.
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          refreshSubscribers.push({ resolve, reject });
        }).then(retryWith);
      }

      isRefreshing = true;
      let token: string;
      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        token = data.access_token;
        localStorage.setItem('access_token', token);
      } catch (refreshError) {
        // Only a clear "no" ends the session. A busy server, a rate limit (429) or a dropped
        // connection must never sign anyone out: the original error is passed on and the next
        // request simply tries again.
        const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
        if (status === 401 || status === 403) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
          // The session is gone (signed out, deactivated or password reset): tell the app to
          // return to the sign-in page instead of leaving a half-working screen.
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
        onRefreshFailed(error);
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
      onRefreshed(token);
      return retryWith(token);
    }

    return Promise.reject(error);
  },
);

export default api;
