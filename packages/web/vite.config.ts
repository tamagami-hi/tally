import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 47561,
    proxy: {
      "/api": "http://127.0.0.1:47560",
      "/events": "http://127.0.0.1:47560",
    },
  },
});
