import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // H7: UI kit en chunk propio (caché larga, diffs pequeños).
        // React queda en el chunk inicial (app de una sola pantalla).
        manualChunks: {
          ui: [
            "lucide-react",
            "sonner",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-avatar",
            "@radix-ui/react-scroll-area",
          ],
        },
      },
    },
  },
  server: { port: 5173 },
  // Los paquetes del workspace se sirven desde fuente (HMR directo).
  // Sin esto, Vite los pre-empaqueta una vez y los editas en vano: el
  // navegador sigue ejecutando el bundle viejo hasta reiniciar con --force.
  optimizeDeps: {
    exclude: [
      "@cookie/core",
      "@cookie/drawing",
      "@cookie/platform-capacitor",
      "@cookie/platform-web",
      "@cookie/protocol",
      "@cookie/storage",
      "@cookie/sync",
      "@cookie/ui",
    ],
  },
});
