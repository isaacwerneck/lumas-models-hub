import { writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("apps/web/dist");
const isNetlify = Boolean(process.env.NETLIFY || process.env.CONTEXT);
const proxyTarget = process.env.API_PROXY_TARGET?.trim().replace(/\/$/, "");
const socketTarget = process.env.VITE_SOCKET_URL?.trim().replace(/\/$/, "");

const requireHttpsOrigin = (name, value) => {
  if (!value) throw new Error(`${name} é obrigatória no build do Netlify.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/") {
    throw new Error(`${name} deve ser uma origem HTTPS sem caminho, por exemplo https://api.onrender.com.`);
  }
  return url.origin;
};

if (isNetlify && process.env.VITE_API_URL?.trim()) {
  throw new Error("No Netlify, deixe VITE_API_URL vazia para manter o refresh cookie no proxy same-origin.");
}

const apiOrigin = proxyTarget ? requireHttpsOrigin("API_PROXY_TARGET", proxyTarget) : undefined;
const socketOrigin = socketTarget ? requireHttpsOrigin("VITE_SOCKET_URL", socketTarget) : undefined;

if (isNetlify && (!apiOrigin || !socketOrigin)) {
  throw new Error("Configure API_PROXY_TARGET e VITE_SOCKET_URL no Netlify antes de publicar.");
}

const redirects = [
  ...(apiOrigin ? [`/api/*  ${apiOrigin}/api/:splat  200!`] : []),
  "/*  /index.html  200"
].join("\n");

const connectSources = ["'self'"];
if (socketOrigin) {
  connectSources.push(socketOrigin, socketOrigin.replace(/^https:/, "wss:"));
}
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSources.join(" ")}`
].join("; ");

const headers = `/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000

/index.html
  Cache-Control: no-cache, no-store, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

await Promise.all([
  writeFile(path.join(outputDirectory, "_redirects"), `${redirects}\n`, "utf8"),
  writeFile(path.join(outputDirectory, "_headers"), headers, "utf8")
]);

console.log(`Netlify artifacts generated${apiOrigin ? ` with API proxy to ${apiOrigin}` : " for local verification"}.`);
