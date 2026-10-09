# Responder a cuota excedida (D1/R2/Workers)

Síntoma: `QUOTA_EXCEEDED`, `RATE_LIMITED` sostenido o alertas de costo.

1. La app ya preserva drafts/outbox locales: **nada se borra ni se descarta
   silenciosamente**. La sincronización muestra pendiente/error corregible.
2. Confirmar qué cuota saltó en `/internal/metrics` (rutas con más 4xx/5xx)
   y en el dashboard de Cloudflare.
3. Degradar uploads: bajar límites por respuesta (413) sin borrar historia.
4. Ejecutar `POST /internal/maintenance/gc` para huérfanos y vencidos.
5. Si es sostenido: subir plan o migrar el adapter de persistencia
   (contratos `Db`/`ObjectStore` aíslan el cambio).
6. Reabrir sync: los clientes reintentan con las mismas keys (sin duplicar).
