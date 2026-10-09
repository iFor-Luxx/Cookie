# Reparar cursor de un cliente

Síntoma: historial que no converge, huecos de `seq` o `snapshotRequired`.

1. Pedir al cliente su `lastEventSeq` (badge de estado en la app).
2. Comparar con `GET /internal/spaces/{id}/seq` → `currentSeq`.
3. Casos:
   - `lastSeq < minSeq` (eventos podados): el cliente debe recargar
     snapshot (timeline completo + cursor nuevo). Lo hace solo vía `reconcile`.
   - Hueco intermedio: pedir `GET /v1/pair-spaces/{id}/events?afterSeq={lastSeq}`
     y aplicar en orden; duplicados se ignoran por `eventId`/`seq`.
   - `lastSeq > currentSeq`: cursor corrupto local → limpiar cursor y snapshot.
4. Nunca reordenar por hora de cliente: el orden lo define `eventSeq`.
5. Si el outbox tiene `failed`, reintentar desde la UI (misma
   `Idempotency-Key`: no duplica).
