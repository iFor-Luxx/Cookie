# 11. Operación, pruebas y costos

## Entornos

| Entorno | Uso | Separación |
|---|---|---|
| Local | Desarrollo en Wrangler/local DB, mocks y emuladores. | Nunca credenciales ni datos reales. |
| Staging | Integración, pruebas en dispositivos y FCM de prueba. | Proyecto, DB, bucket y secrets independientes. |
| Producción | Uso real y datos personales. | Privilegios mínimos, alertas, backups y dominios propios. |

## CI/CD

Pull request ejecuta format/lint, typecheck, unit/contract tests, builds web y Worker, validación de migraciones y secret/dependency scan. Merge protegido despliega staging y smoke tests. Release etiquetada despliega con migrations compatibles y construye APK firmado.

- Android signing key fuera del repo y de jobs de CI sin privilegio.
- Migraciones `expand-contract`: primero añadir campos, desplegar compatibilidad, después retirar obsoletos en otra release.
- Rollback de aplicación no debe depender de revertir datos destructivamente.
- Promover a producción con aprobaciones de ambiente y changelog.
- Distribución inicial privada/internal testing; requisitos de Play Store se confirman antes de publicación.
- Crear reproducible build y guardar checksum/signature del APK release.

## Estrategia de pruebas

| Nivel | Casos |
|---|---|
| Unit | Políticas de dominio, límites, estados offline, cursor, documento y migraciones de drawing format. |
| Contract | Schemas HTTP/WS, errores, versión desconocida, payloads malformados y límites. |
| Integración | D1 transacciones, invite concurrente, idempotencia, upload/GC, DO restart/replay. |
| E2E web | Alta, pairing, dibujo, publicación, offline/online, historial, revoke. |
| E2E Android | APK, pairing, stylus, FCM, widget background donde OS lo permita, tap/deep link, revoke. |
| Visual | Fixtures deterministas de texturas en pantallas/densidades reales; tolerancia controlada entre GPU. |
| Resiliencia | ACK perdido, retries duplicados, desconexión, bursts reconnect, upload parcial, cuota excedida. |
| Seguridad | IDOR, cross-space access, token revocation, invite replay/expiry, XSS, R2 auth y filtración en logs. |

Los tests del widget verifican estados permitidos/prohibidos por OS. No declarar que test passing significa actualización garantizada en todos los fabricantes.

## Observabilidad

### Logs

Campos permitidos: `requestId`, ID pseudónimo de installation, hash de PairSpace, operation, status, duration, provider code y version. No guardar bytes, URLs firmadas, refresh/access tokens, invites ni contenido.

### Métricas

- API error rate y p50/p95/p99.
- D1 rows read/written, duración, overload y cuota.
- R2 bytes/ops, uploads fallidos y blobs huérfanos.
- WS conectados, reconexiones, gaps de cursor, replay y cierres.
- Outbox backlog, retry age, publicaciones duplicadas evitadas.
- Push enviado/aceptado/rechazado; medir por instalaciones sin registrar contenido.
- Crash/jank por versión y modelo Android.
- Costo estimado por mes y por PairSpace.

### Alertas/runbooks

Alertar por error sostenido, backups vencidos, picos de filas/costos, falla FCM, migración, cola creciendo y upload abuse. Runbooks: revocar instalación, reparar cursor, restaurar backup, rotar secrets, degradar upload, rollback y responder a borrado.

## Costos y cuotas

El stack Cloudflare es candidato para bajo costo operacional, no significa gratis o ilimitado. Variables: requests/CPU Workers, DO, filas leídas/escritas D1, GB-mes/operaciones R2, backups, push/monitoring y distribución. Confirmar precios, cuotas, impuestos/región y condiciones antes de producción.

- Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
- R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Durable Object WebSockets: <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- Android widget updates: <https://developer.android.com/develop/ui/views/appwidgets/advanced>
- Capacitor docs: <https://capacitorjs.com/docs>
- Firebase Android receive messages: <https://firebase.google.com/docs/cloud-messaging/android/receive-messages>

En las páginas revisadas el 9 de octubre de 2026, los límites free de D1 podían hacer fallar consultas al excederse y el plan Workers pago mostraba tarifa base/cargos de uso. R2 documentaba cuota de almacenamiento/operaciones y egress sin cargo. Los valores pueden cambiar; no estimar presupuesto con cifras antiguas ni prometer un plan gratuito permanente.

### Respuesta a quota

Si se excede cuota: preservar drafts/outbox locales, explicar que la sincronización está pausada, no borrar historia, alertar operador y permitir retry tras recuperar servicio. Nunca descartar dibujo silenciosamente.

## Respaldo, recuperación y salida de proveedor

- Backup SQL/export lógico periódico y plan de restore probado.
- Inventario/manifest de objetos R2 y hashes verificables.
- Definir RPO/RTO alcanzables según plan seleccionado.
- Export de PairSpace como JSON versionado + blobs permite migrar storage.
- Mantener contratos y repositorios separados de bindings Cloudflare para reducir coste de salida.
