# 5. Modelo de datos y persistencia

## 5.1 Principios

- D1 almacena datos relacionales pequeños, metadatos, eventos y estado de autorización.
- R2 guarda documentos vectoriales, renders, miniaturas y avatares.
- Nunca almacenar base64 de una imagen en SQL, log, FCM o frame WebSocket.
- `PairSpace` es dueño lógico de los dibujos y eventos compartidos.
- Cada `Drawing` publicada es inmutable; eliminar crea tombstone/evento, no desaparición silenciosa.
- Los relojes de cliente son informativos. El orden global dentro del espacio lo determina `eventSeq`.
- Los IDs son aleatorios no enumerables, pero no se consideran credenciales.

## 5.2 Entidades

| Entidad | Campos base | Reglas |
|---|---|---|
| `UserProfile` | `userId`, `displayName`, `avatarObjectKey?`, `createdAt`, `updatedAt` | Nombre visible 1–32; avatar opcional y reemplazable. |
| `Installation` | `installationId`, `userId`, `platform`, `credentialHash`, `pushToken?`, `createdAt`, `lastSeenAt`, `revokedAt?` | Token independiente por instalación; revocación inmediata. |
| `PairSpace` | `pairSpaceId`, `status`, `createdAt`, `nextEventSeq`, `retentionPolicy` | MVP máximo dos miembros activos. |
| `Membership` | `pairSpaceId`, `userId`, `role`, `joinedAt`, `leftAt?` | Unique por par; membership vigente autoriza acceso. |
| `RecoveryCredential` | `credentialId`, `pairSpaceId`, `secretHash`, `createdAt`, `usedAt?`, `revokedAt?` | Hash; secreto mostrado una sola vez y rotatable. |
| `Invite` | `inviteId`, `pairSpaceId`, `tokenHash`, `createdBy`, `expiresAt`, `consumedAt?` | One-time y TTL corto. |
| `Drawing` | `drawingId`, `pairSpaceId`, `authorUserId`, `createdAt`, `documentKey`, `previewKey`, `renderKey?`, `width`, `height`, `contentHash`, `deletedAt?` | Orden secundario por id; blobs verificados. |
| `Event` | `pairSpaceId`, `seq`, `eventId`, `type`, `actorUserId`, `entityId`, `payloadVersion`, `createdAt` | `seq` monotónico por PairSpace y unique. |
| `IdempotencyRecord` | `scope`, `key`, `requestHash`, `responseJson`, `expiresAt` | Reintento retorna mismo resultado. |
| `UploadIntent` | `uploadId`, `installationId`, `pairSpaceId`, `objectKey`, `expectedHash`, `maxBytes`, `expiresAt`, `consumedAt?` | Key emitida por servidor; no reutilizable tras consumo. |
| `OutboxJob` | `jobId`, `type`, `payload`, `createdAt`, `attempts`, `nextAttemptAt`, `status` | Despacho posterior a commit, retry y dead-letter acotado. |

## 5.3 SQL de referencia

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE pair_spaces (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active','locked','deleting','deleted')),
  created_at TEXT NOT NULL,
  next_event_seq INTEGER NOT NULL DEFAULT 1,
  retention_policy TEXT NOT NULL DEFAULT 'until_deleted'
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 32),
  avatar_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('web','android')),
  credential_hash TEXT NOT NULL,
  push_token TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX installations_user_active ON installations(user_id, revoked_at);

CREATE TABLE memberships (
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY(pair_space_id, user_id)
);
CREATE INDEX memberships_user_active ON memberships(user_id, left_at);

CREATE TABLE drawings (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  document_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  render_key TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX drawings_space_timeline ON drawings(pair_space_id, created_at DESC, id DESC);

CREATE TABLE events (
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(pair_space_id, seq)
);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
);
```

Es un esquema inicial, no migración final. Validar longitudes, collation, expiración, `CHECK` y comportamiento de D1 al implementar. Todas las consultas que filtran por espacio/tiempo deben tener índice y prueba de plan/volumen.

## 5.4 Cursor y orden del timeline

- Timeline usa cursor opaco derivado de `(createdAt, drawingId)` para páginas de dibujos.
- Eventos usan `seq` entero monotónico por PairSpace; cada evento se asigna en la transacción que confirma el cambio.
- Cursor no se calcula con hora del cliente.
- Para timeline con tombstones, filtrar en query visible y propagar tombstone por endpoint de eventos.
- Si cursor de eventos queda fuera de retención, responder `snapshotRequired`; cliente recarga primera página y nuevo cursor.

## 5.5 Estructura de objetos R2

Paths generados por el servidor; ejemplo lógico:

```text
spaces/{opaque-space-id}/drawings/{opaque-drawing-id}/doc-v1.json.zst
spaces/{opaque-space-id}/drawings/{opaque-drawing-id}/preview-v1.webp
spaces/{opaque-space-id}/drawings/{opaque-drawing-id}/render-v1.webp
users/{opaque-user-id}/avatars/{opaque-avatar-version}.webp
```

- Bucket privado sin lectura pública.
- Validar MIME por bytes, no solo `Content-Type` proporcionado.
- Usar hash de contenido, límites de ancho/alto y límites comprimidos/descomprimidos para mitigar decompression bombs.
- Claves no contienen nombre visible, email ni secretos.
- Descargas vía Worker o URL presignada de vida corta, limitada a un objeto.
- Cache headers privados/versionados; no cachear URLs temporales durante más de su TTL.
- Definir política de lifecycle para uploads incompletos, previews sustituidos y objetos huérfanos.

## 5.6 Retención, borrado y backup

- Desvincular instalación NO borra perfil, PairSpace ni dibujos.
- Borrado de un Drawing crea tombstone y evento. Retención física posterior permite corregir borrado accidental según decisión de producto.
- Cierre de PairSpace marca `deleting`, revoca credenciales e impide nuevas lecturas; purga blobs y SQL tras periodo de gracia definido.
- Exportación de contenido debe devolver manifest versionado y blobs, con URLs privadas temporales.
- Mantener backups/export de D1 y estrategia de blobs (versionado/lifecycle según costo); probar restauración, no basta tener backups.
- Restaurar backup exige reconciliar IDs/eventSeq con archivos R2 y poner API en modo mantenimiento durante la operación.
- Documentar RPO/RTO realistas del plan elegido antes de prometerlos.

## 5.7 Datos locales

- Web: IndexedDB para drafts, outbox, caché de previews y cursores.
- Android: SQLite para outbox/metadata, carpeta privada para documento y previews, Keystore para secreto de instalación.
- Persistir primero el draft/outbox, luego iniciar request; una terminación del proceso no debe borrar un dibujo pendiente.
- Política de limpieza LRU para caché descargada, nunca limpiar items queued o drafts sin autorización del usuario.
- El cliente puede rehidratar historial desde nube; la caché no es única copia de contenido confirmado.
