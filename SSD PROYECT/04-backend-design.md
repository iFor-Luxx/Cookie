# 4. Backend y contratos de servicio

## 4.1 Responsabilidades del backend

El backend es autoridad de identidad de instalaciones, membresías, invitaciones, orden de publicación y autorización. Un cliente no puede decidir por sí mismo que un dibujo ya está compartido. Cada ruta valida schema, permisos, límites de bytes, rate limits y estado de PairSpace antes de mutar datos.

Componentes lógicos:

- **API Worker:** HTTPS, autenticación, autorización, validación, rate limiting, upload intents y lecturas.
- **PairRoom Durable Object:** WebSocket, presencia efímera, control de conexiones y fanout de eventos confirmados.
- **D1 repositories:** consultas parametrizadas y transacciones de dominio.
- **R2 access layer:** paths privados, validación de tipos/tamaños, uploads y descargas.
- **Notification job:** entrega FCM a instalaciones Android registradas, deduplicación, retries acotados.
- **Maintenance jobs:** cleanup de objetos huérfanos, expiración de invitaciones/idempotencia y análisis de integridad.

El API Worker no contiene reglas duplicadas en routers diferentes. Las reglas deben residir en casos de uso/servicios del backend y tener pruebas de dominio.

## 4.2 Reglas de autenticación y autorización

- Cada instalación tiene credencial revocable separada de `userId` y `pairSpaceId`.
- El cliente obtiene tokens de acceso cortos y los renueva con una credencial más protegida. No almacenar bearer en `localStorage`.
- El Worker identifica `installationId`, user y revocación; después consulta membresía vigente para PairSpace solicitado.
- Rechazar acceso aunque el cliente adivine/obtenga un `drawingId`, `objectKey` o `pairSpaceId` válido.
- No incluir credencial de larga vida en query string. Para WS, emitir ticket de un solo uso y expiración de segundos.
- Al revocar instalación, detener nuevas requests, cerrar sockets asociados cuando sea viable y limpiar token FCM.
- Tokens y códigos se comparan mediante hashes criptográficos; nunca loguear el valor original.

## 4.3 Prefijo y convenciones de API

Prefijo `/v1`; JSON UTF-8 para controles. Todos los endpoints responden con `requestId`. Errores con código estable y `retryable`. Cabeceras mínimas:

```http
Authorization: Bearer <short-lived-access-token>
Content-Type: application/json
Idempotency-Key: <uuid>          # mutaciones reintentables
X-Client-Version: <semver>
X-Protocol-Version: 1
```

## 4.4 Endpoints de referencia

| Método y ruta | Descripción | Reglas |
|---|---|---|
| `POST /v1/installations` | Crear instalación y obtener credenciales iniciales. | Throttle por IP; salida secreta una sola vez. |
| `POST /v1/sessions/refresh` | Renovar access token. | Rotación; detección de reuse; revocar familia si se reutiliza refresh. |
| `DELETE /v1/sessions/current` | Cerrar sesión de instalación. | Revoca refresh/access asociados y socket. |
| `GET /v1/me` | Cargar perfil y capacidades. | No devuelve hashes ni secretos. |
| `PATCH /v1/me` | Cambiar nombre o avatar. | Validar nombre/tipo/tamaño; emitir event si cambia el perfil compartido. |
| `POST /v1/pair-spaces` | Crear PairSpace y primer miembro. | Crea recovery secret solo mostrado una vez. |
| `POST /v1/pair-spaces/{id}/invites` | Crear invitación. | Máximo un invite activo recomendado; expiración breve. |
| `POST /v1/invites/consume` | Consumir invitación. | Una transacción; uso único; check de capacidad. |
| `POST /v1/pair-spaces/{id}/recovery-challenges` | Iniciar recuperación. | Rate limit; respuesta indistinguible para IDs inválidos. |
| `POST /v1/recovery/complete` | Completar con secreto/aprobación. | Rotar credenciales y emitir audit event. |
| `POST /v1/uploads/intents` | Autorizar upload de documento/preview/avatar. | MIME permitido, tamaño, hash, path asignado server-side. |
| `POST /v1/pair-spaces/{id}/drawings` | Publicar Drawing. | Requiere blob ya cargado y `Idempotency-Key`. |
| `GET /v1/pair-spaces/{id}/drawings?cursor=...` | Timeline paginado. | Cursor opaco; máximo 50 elementos/página. |
| `GET /v1/pair-spaces/{id}/events?afterSeq=N` | Replay de eventos. | Límite de batch; snapshotRequired si cursor no retenido. |
| `GET /v1/drawings/{id}` | Metadata y URL temporal de recursos. | Revalidar membresía cada vez. |
| `DELETE /v1/drawings/{id}` | Eliminar/tombstone según política. | Autor o miembro según regla aprobada; idempotente. |
| `POST /v1/installations/{id}/revoke` | Revocar instalación de este user. | Una instalación no se autorrevoca accidentalmente sin confirmación. |
| `GET /v1/health` | Health público reducido. | No revelar bindings, versiones secretas ni datos de usuario. |

## 4.5 Publicación de un dibujo

1. Cliente persiste localmente `drawingId`, `clientMutationId`, documento y preview en outbox.
2. `POST /uploads/intents` solicita un objeto para PairSpace activo. El servidor genera `objectKey` aleatorio y registra alcance/TTL/tipo esperado.
3. Cliente sube blobs. El upload se limita por bytes, dimensiones y MIME detectado; nunca aceptar key arbitraria del cliente.
4. `POST /drawings` incluye claves asignadas, tamaño, hash, canvas metadata y resumen de herramientas. El servidor verifica propiedad del upload y hash.
5. El caso de uso inserta `Drawing`, `Event` e `IdempotencyRecord`, y avanza cursor en una transacción D1.
6. Tras commit, responde 201 con representación canónica y `eventSeq`.
7. Publica un aviso a Durable Object/cola. Si el fanout falla después del commit, los clientes lo recuperan mediante cursor.
8. Job de GC elimina blobs subidos sin referencia cuando vence la ventana de seguridad.

La primera respuesta exitosa define el instante confirmado. Antes del commit, la UI puede mostrar estado local/pendiente, nunca “enviado” como estado durable.

## 4.6 Idempotencia y errores

- Cada mutación reintentable usa `Idempotency-Key` generada antes de enviar.
- Misma key + mismo hash de request devuelve la respuesta original.
- Misma key + cuerpo diferente devuelve `409 IDEMPOTENCY_CONFLICT`.
- Guardar idempotencia al menos tanto como la ventana máxima de retries offline prevista; expirar por job.
- La idempotencia cubre comando, no sustituye deduplicación de FCM/eventos.

Errores normalizados:

```json
{
  "error": {
    "code": "INVITE_EXPIRED",
    "message": "La invitación ya no es válida",
    "retryable": false
  },
  "requestId": "req_opaque"
}
```

Códigos: `UNAUTHENTICATED`, `FORBIDDEN`, `PAIRSPACE_FULL`, `INVITE_EXPIRED`, `INVITE_ALREADY_USED`, `IDEMPOTENCY_CONFLICT`, `UPLOAD_EXPIRED`, `BLOB_NOT_FOUND`, `CURSOR_EXPIRED`, `RATE_LIMITED`, `VALIDATION_ERROR`, `QUOTA_EXCEEDED`, `TEMPORARY_UNAVAILABLE`.

## 4.7 Límites y antiabuso iniciales

Valores provisionales a ajustar mediante pruebas y cuotas:

- Documento JSON comprimido: máximo 2 MiB por dibujo en MVP.
- Preview: máximo 512 KiB, lado máximo 1024 px.
- Imagen completa derivada: máximo 4 MiB, dimensiones máximas iniciales 2048 × 2048.
- Request API JSON general: máximo 256 KiB, excluyendo upload binario.
- Lote de eventos: 100 eventos o 1 MiB, lo que ocurra primero.
- Timeline: 50 dibujos por página.
- Rate limit de invitaciones/recovery/publicaciones por instalación y por IP; configurar límites conservadores con métricas.
- Aplicar cuota de bytes por PairSpace; rechazar con `QUOTA_EXCEEDED` sin borrar contenido existente.

Los límites son controles de seguridad y rendimiento, no tamaños finales de producto; validar en dispositivos y con formatos reales.

## 4.8 Consistencia de transacciones

- D1 commit de dibujo y evento debe ser atómico.
- Enviar WS/FCM solo después del commit.
- Fallo de fanout no revierte la publicación; replay de eventos repara clientes.
- Invitación se consume transaccionalmente: dos accept concurrentes no pueden asignar el mismo cupo.
- Si R2 y D1 no comparten transacción, aplicar saga simple: upload temporal → commit SQL → GC de orphan; nunca declarar una pieza como confirmada si no se pueden leer sus blobs.
- Usa outbox transaccional en D1 para publicar trabajos asíncronos de forma fiable, o una estrategia equivalente que permita retry.

## 4.9 Separación de capas server

```text
HTTP handler / WebSocket handler
  -> parse + validate + authenticate
  -> application use case
  -> domain policy
  -> repository / object store / queue ports
  -> infrastructure adapter (D1, R2, DO, FCM)
```

Handlers deben ser delgados. No realizar lecturas de tablas distintas para cada subcampo del timeline; evitar N+1. SQL parametrizado y revisado, paginación por cursor e índices explícitos.
