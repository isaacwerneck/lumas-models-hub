export const API_URL = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:3333"))
  .trim()
  .replace(/\/$/, "");

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim().replace(/\/$/, "");

/** HTTP may use Netlify's same-origin proxy while Socket.IO connects directly to Render. */
export const SOCKET_URL = configuredSocketUrl
  || API_URL
  || (typeof window === "undefined" ? "" : window.location.origin);
