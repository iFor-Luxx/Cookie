# H8 — Piloto privado (2 personas, 1 mes)

## 1. Desplegar staging

```sh
# Una vez por entorno (IDs reales solo en staging/prod)
bunx wrangler d1 create cookie-staging
bunx wrangler r2 bucket create cookie-staging

# Aplicar migraciones (append-only, append-only)
bunx wrangler d1 migrations apply cookie-staging --config infra/wrangler/wrangler.staging.jsonc

# Secretos (nunca en el repo)
bunx wrangler secret put ACCESS_SECRET --config infra/wrangler/wrangler.staging.jsonc
bunx wrangler secret put INTERNAL_SECRET --config infra/wrangler/wrangler.staging.jsonc
# FCM (cuenta de servicio JSON completa como secreto si se activa push server-side)
# bunx wrangler secret put FCM_SERVICE_ACCOUNT --config infra/wrangler/wrangler.staging.jsonc

# Desplegar
bunx wrangler deploy --config infra/wrangler/wrangler.staging.jsonc
```

Verificación post-deploy: `GET /v1/health`, crear instalación de prueba,
`GET /internal/metrics` con secreto interno.

## 2. App web + APK

- Web: `VITE_API_URL=https://<worker> bun --filter ./apps/web build`.
  Sin backend propio: puede apuntar a staging desde PC.
- Android: `bun --filter ./apps/android sync`, abrir en Android Studio,
  `assembleDebug`, instalar por USB (depuración privada, no Play Store).
  `VITE_API_URL` y `VITE_WS_URL` (wss) vía variables de build.

## 3. Guion de pairing (las 2 personas)

1. A instala, crea espacio, **guarda ID + recovery secret fuera del móvil**.
2. A genera invitación y la pasa por canal privado (TTL 1h por defecto).
3. B instala, se une con el token. Ambas ven el historial vacío.
4. A publica un dibujo → B lo ve (realtime o al abrir).
5. B publica otro → A lo recibe. Probar un ciclo con **datos apagados**
   en uno (outbox → reintento sin duplicar).
6. Añadir el widget en Android y repetir 4 (best-effort).

## 4. Qué registrar durante el mes

- `GET /internal/metrics` semanal (conteos por ruta/estado).
- Dashboard Cloudflare: requests/CPU Workers, filas D1, ops R2, costo estimado.
- Crash-free Android por versión/OEM; jank del lienzo en el modelo más débil.
- Feedback: fricción en pairing/recovery, latencia percibida, widget (¿llegó?
  ¿cuánto tardó?), confusión con estados pendiente/error.
- Cualquier `failed` en outbox con su código (investigar, no borrar).

## 5. Criterio de salida

Un mes sin fallos de integridad (cero dibujos perdidos/duplicados),
costos dentro de lo previsto y feedback incorporado o registrado como
deuda. Ver [../acceptance-h7.md](../acceptance-h7.md).
