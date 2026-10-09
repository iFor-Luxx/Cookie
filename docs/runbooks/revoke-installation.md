# Revocar instalación

Síntoma: dispositivo perdido, token robado o sesión anómala.

1. Identificar `installationId` (ver `installations` por `user_id` y `last_seen_at`).
2. Como el propio usuario: `POST /v1/installations/{id}/revoke` con
   `{"confirm": true}` y el access token de otra instalación vigente.
3. Efecto inmediato: la instalación deja de autenticar (HTTP 401), sus
   refresh sessions se revocan, su token FCM se limpia y se notifica
   `installation.revoked` a los Durable Objects (cierre de sockets vivos).
4. Verificar: `GET /v1/me` con el access viejo → 401.
5. El historial del PairSpace NO se borra (tombstones solo vía delete explícito).

Si no queda ninguna instalación vigente del usuario, usar recovery
(secreto del espacio o aprobación del otro miembro).
