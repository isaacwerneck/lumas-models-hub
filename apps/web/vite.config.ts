import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const config = loadEnv(mode, process.cwd(), "");
  const isDevelopment = mode === "development";
  const apiUrl = config.VITE_API_URL || (isDevelopment ? "http://localhost:3333" : "");
  const socketUrl = config.VITE_SOCKET_URL || apiUrl;
  const connectSources = new Set(["'self'"]);
  for (const candidate of [apiUrl, socketUrl]) {
    if (!candidate) continue;
    const origin = new URL(candidate).origin;
    connectSources.add(origin);
    connectSources.add(origin.replace(/^http/, "ws"));
  }
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    // O React Refresh injeta um pequeno preâmbulo inline somente no servidor do Vite.
    isDevelopment ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(" ")}`
  ].join("; ");
  const headers = {
    "Content-Security-Policy": `${csp}; frame-ancestors 'none'`,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };

  return {
    plugins: [
      react(),
      {
        name: "lumas-security-meta",
        transformIndexHtml: () => [{
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: csp },
          injectTo: "head-prepend"
        }]
      }
    ],
    server: { headers },
    preview: { headers }
  };
});
