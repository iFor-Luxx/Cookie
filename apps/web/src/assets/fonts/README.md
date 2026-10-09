# Fuentes locales (APK offline)

`index.css` espera estos woff2 aquí (vía `@font-face` + `preload` en `index.html`):

- `instrument-serif-latin-400.woff2` + `instrument-serif-latin-400-italic.woff2`
  → Google Fonts “Instrument Serif” (OFL). Descargar de
  https://fonts.google.com/specimen/Instrument+Serif
- `geist-pixel-square-latin-400.woff2`
  → ÚNICA variante pixel (Square). Fuente: `vercel/geist-pixel-font`
  releases (OFL-1.1) o Google Fonts “Geist Pixel” (eje ELSH).
  No vendorear Grid/Circle/Triangle/Line.

Pasos: descargar woff2 latin → renombrar como arriba → `bun run build:web`.
Vite los emite a `dist/fonts/` vía `assetsInlineLimit` default; Capacitor los
sirve offline desde `webDir`.
