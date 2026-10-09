# 12. Decisiones, riesgos y roadmap

## Decisiones de producto por cerrar

| Pregunta | Recomendación inicial | Bloqueante |
|---|---|---|
| Si ambos pierden dispositivo y recovery secret, ¿qué ocurre? | Sin recuperación automática; indicar este hecho al crear recovery. | Sí, auth final. |
| ¿Quién puede borrar un Drawing? | Autor y owner; tombstone y restauración breve. | Sí, API final. |
| ¿Se sincronizan borradores entre dispositivos? | No en MVP; drafts solo locales. | No. |
| ¿Retención y borrado de PairSpace? | Retener hasta borrado explícito; periodo de gracia antes de purga. | Sí, lanzamiento. |
| ¿Widget en lock screen muestra imagen? | Preferencia explícita, default privado. | Sí, widget. |
| ¿E2EE? | No MVP; dejar ADR y compatibilidad futura. | No para MVP. |
| ¿Distribución Android? | Piloto privado primero; validar requisitos actuales de tienda después. | Sí, release público. |
| ¿Stylus presión? | Usar si disponible, degradar a touch/mouse. | No. |
| ¿Máximo de instalaciones por usuario? | Configurable, con límite inicial razonable para seguridad/costos. | No. |

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Android/OEM aplaza widget | Usuario cree que envío falló. | Mostrar timestamp, cache estable, FCM+WorkManager+reconciliación al abrir; explicar best-effort. |
| Recuperación confusa | Pérdida de acceso o acceso indebido. | Prototipar recovery; secreto independiente y aprobación de miembro; no usar IDs como auth. |
| Tarifas/quotas cambian | Sync pausada o gasto inesperado. | Alertas, cuotas propias, fallback local y revisión antes de cada release mayor. |
| Canvas difiere entre WebView y browser | Textura distinta o lag. | Documento canónico, renderer versionado, fixtures y profiling real. |
| Blob sensible queda público | Exposición de contenido. | Bucket privado, authorization check, URL breve y auditoría de paths. |
| Durable Object se reinicia | Cliente pierde socket/evento. | D1 como autoridad, replay cursor, reconexión y pruebas de eviction/deploy. |
| Textura/licencia incompatible | Bloqueo de distribución. | Texturas propias o revisión legal/licencia y registro SBOM. |
| Core se vuelve monolito | Web/app difíciles de cambiar. | Límites por paquetes, ADR, dependencias unidireccionales y ownership de módulos. |

## Roadmap por hitos

| Hito | Entregable | Criterio de salida |
|---|---|---|
| 0. Definición | ADR auth/recovery, borrado, stack, format, licencias, versión Android mínima. | Decisiones bloqueantes resueltas. |
| 1. Fundaciones | Bun monorepo, tsconfig, core/protocol, CI y builds. | Build reproducible web/Worker/Capacitor. |
| 2. Pairing | Installation, perfil, PairSpace, invite, recovery y revoke. | Dos instalaciones vinculadas; permisos probados. |
| 3. Dibujo local | Canvas, tres herramientas, undo, autosave. | Render determinista y draft tras cierre. |
| 4. Backend/historial | D1/R2, uploads, publicación idempotente, timeline. | Drawing confirmada y recuperable en ambos. |
| 5. Sync | WS, event cursor, outbox, replay, retry. | Corte de red no duplica ni pierde publicación. |
| 6. Widget | Kotlin AppWidget, FCM, WorkManager, cache e intents. | Best-effort demostrado en dispositivos físicos; límites documentados. |
| 7. Hardening | Seguridad, performance, observabilidad, backups, privacidad. | Criterios de aceptación y runbooks satisfechos. |
| 8. Piloto | Distribución privada a dos personas. | Mes de métricas/costos y feedback sin fallos de integridad. |

## Criterios de aceptación

1. Nombre requerido y avatar opcional en onboarding; invite caduca y no se consume dos veces.
2. Dos usuarios ven todos los dibujos publicados en historial común.
3. Publicación conserva vector y preview; ambas sesiones conectadas la ven sin refrescar manualmente en red normal.
4. Reinstalar/desvincular no borra el historial; recovery solo por flujo autorizado.
5. Retry de comando usa misma key y no duplica Drawing.
6. Offline conserva borrador y outbox; al volver red converge o muestra error corregible.
7. Cursor gap y expiración recuperan delta o snapshot sin saltarse cambios silenciosamente.
8. Widget presenta última preview confirmada, abre Drawing correcto y comunica que actualización depende de Android.
9. Revocar instalación cierra HTTP/WS futuro y desactiva su FCM token.
10. Usuario de otro PairSpace no puede leer, modificar ni borrar recursos cambiando IDs.
11. Backup puede restaurarse; logs no tienen dibujo ni secretos; se observan costos y límites.
12. Canvas cumple presupuesto en teléfono de referencia y modo degradado evita freezes en equipo modesto.
13. Web y Android importan el mismo core de dominio y drawing; ninguna regla central está duplicada en UI.

## Arquitectural Decision Records

Plantilla mínima por decisión:

```text
ADR-NNN: título
Estado: propuesta | aceptada | reemplazada
Contexto y restricciones:
Opciones consideradas:
Decisión:
Consecuencias positivas y negativas:
Métrica/condición que obliga a revisar:
Fecha y responsable:
```

ADRs iniciales: identidad/recovery; stack/cloud; dibujo y renderer; storage local; borrado/retención; widget/FCM; E2EE si se reabre.
