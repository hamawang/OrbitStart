import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      // Keep auxiliary WebView windows independent from the main React bundle.
      // Tauri opens these HTML files directly (see create_bubble_*_window).
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "floating-bubble": fileURLToPath(new URL("./floating-bubble.html", import.meta.url)),
        "floating-bubble-menu": fileURLToPath(new URL("./floating-bubble-menu.html", import.meta.url))
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  }
});
