# Rotar secretos

## JWT access secret (firma de access tokens)

1. Generar nuevo secreto de 32 bytes.
2. Desplegar aceptando viejo+nuevo en verificación (ventana de 15 min,
   el TTL del access token).
3. Desplegar firmando solo con el nuevo. Los refresh siguen válidos
   (opacos, hasheados en DB).

## INTERNAL_SECRET (API ↔ Durable Objects)

1. Configurar el nuevo valor en API y DO a la vez (mismo deploy).
2. Los tickets WS en vuelo (TTL 30s) pueden fallar una vez; el cliente
   reconecta y pide otro.

## Recovery secret de un espacio

No rota solo: es el respaldo del espacio. Si se compromete, crear un
mecanismo de rotación con aviso a ambos miembros (pendiente de producto).
Mientras tanto: revocar instalaciones afectadas y vigilar `events`.
