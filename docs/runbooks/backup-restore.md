# Respaldo y restauración (D1 + R2)

## Respaldo

- D1: export SQL periódico (`wrangler d1 export`) + guardar fuera del plan.
- R2: inventario de `object_key` con hashes (`GET /v1/pair-spaces/{id}/export`
  por espacio + listado de bucket). Los bytes son inmutables (`*-v1.*`).
- Probar la restauración en staging: un backup sin restore probado no existe.

## Restauración

1. Poner la API en mantenimiento (503 con `retryable: true`).
2. Restaurar D1 y verificar `events.seq` contiguos por PairSpace.
3. Reconciliar R2: todo `document_key`/`preview_key` referenciado debe existir
   con el `content_hash` esperado; lo que falte se marca (no se inventa).
4. Levantar mantenimiento; los clientes reconcilian por cursor.
5. RPO/RTO: definir valores reales del plan contratado antes de prometerlos
   (ver `SSD PROYECT/11-operations-testing-costs.md`).
