import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const config = loadEnv(mode, process.cwd(), "");
  const isDevelopment = mode === "development";
  const apiUrl = config.VITE_API_URL || "http://localhost:3333";
  const apiOrigin = new URL(apiUrl).origin;
  const socketOrigin = apiOrigin.replace(/^http/, "ws");
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
    `connect-src 'self' ${apiOrigin} ${socketOrigin}`
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
