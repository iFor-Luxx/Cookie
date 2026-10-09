# Fuentes locales (APK offline)

Servidas desde `apps/web/public/fonts/` → copiadas a `dist/fonts/` verbatim.
`index.css` las referencia como `/fonts/*.ttf` y `index.html` las precarga.

- `InstrumentSerif.ttf` → `Instrument Serif` (400 normal; la itálica se
  sintetiza hasta vendorear el italic real).
  Google Fonts “Instrument Serif” (OFL).
- `GeistPixel.ttf` → `Geist Pixel Square`, ÚNICA variante pixel (no Grid /
  Circle / Triangle / Line). `vercel/geist-pixel-font` (OFL-1.1).

Nota: `GeistPixel.ttf` pesa ~3.6 MiB sin subsetear. Se descarga lazy
(`font-display: swap`, solo donde se usa `font-pixel`), pero antes del
piloto conviene subsetear a latin + convertir a woff2.
