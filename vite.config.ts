import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Vitest 4 runs on a newer Vite core than this React 18 app's Vite 5 dev
  // stack. Let Vitest use esbuild's TSX transform to avoid plugin deprecation
  // noise while keeping the React plugin for dev/build.
  plugins: mode === "test" ? [] : [react()],
  // WorkOS redirects back to VITE_WORKOS_REDIRECT_URI (http://localhost:5173).
  // Pin the port so Vite never silently drifts to 5174 when 5173 is busy —
  // otherwise the OAuth code lands on a port the app isn't served from and
  // login appears to "do nothing" (you stay on the sign-in screen).
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
