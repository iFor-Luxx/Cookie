# H6 — Firebase / FCM + widget (Android)

## Alta de Firebase (acción manual, una vez)

1. Crear proyecto en <https://console.firebase.google.com> (sin Analytics vale).
2. Añadir app Android con ID `dev.luxury.cookie`.
3. Descargar `google-services.json` a `apps/android/android/app/google-services.json`
   (gitignored: contiene IDs del proyecto, no secretos de servidor).
4. Sin ese fichero la app **compila y funciona igual**, pero FCM queda inactivo
   (el plugin `google-services` no se aplica y `FirebaseApp` no inicia).

## Envío server → FCM (pendiente deploy)

Contrato del data message (sin contenido, sin secretos, sin URLs):

```json
{ "data": { "spaceId": "<opaco>", "seq": "42" } }
```

Implementación prevista: job post-commit (outbox server-side) con
Firebase Cloud Messaging HTTP v1 + cuenta de servicio (secreto solo en el
servidor, nunca en la app). Prioridad normal: el widget es best-effort.

## Comportamiento y límites (compromiso de producto)

- El worker (`SyncWorker`, único colapsado `KEEP`) reconcilia por cursor:
  pide `events`, toma el primero del timeline y actualiza preview+cursor.
- La caché del widget guarda **última preview + drawingId + fecha + cursor**.
  Nada de historial, tokens ni URLs firmadas.
- Tap abre `cookie://drawing/{id}` en la app (detalle del historial).
- Tras force-stop no hay trabajo hasta reabrir (límite Android).
- Doze/OEM pueden posponer FCM y WorkManager: la app reconcilia al abrir.
- Sesión del worker: espejo en `Preferences` (`cookie.session` + `cookie.apiBase`),
  escrito por la web (TypeScript). Endurecer a EncryptedSharedPreferences en H7.
- `updatePeriodMillis = 0`: el widget **no** hace polling del sistema.

## Prueba manual (dispositivo físico, Android 10+)

1. `bun run build:android`-equivalente + instalar APK debug.
2. Añadir el widget al launcher → estado vacío ("Sin dibujos todavía").
3. Publicar un dibujo desde la web/otra instalación →
   widget muestra preview + hora (si hay FCM) o al reabrir (reconciliación).
4. Tocar el widget → abre el dibujo correcto.
5. Revocar la instalación → el worker falla auth y no actualiza más.
6. Force-stop → confirmar que no promete nada hasta reabrir.
