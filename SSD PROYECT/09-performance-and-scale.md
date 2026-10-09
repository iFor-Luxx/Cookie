# 9. Rendimiento, fluidez y escalabilidad

## Presupuestos MVP

Son objetivos iniciales de medición, no garantías en cualquier dispositivo. Fijar equipo y red de referencia.

| Métrica | Objetivo inicial |
|---|---|
| Input-to-pixel del canvas | p95 <25 ms en Android de referencia. |
| Fluidez | 55–60 FPS en escena típica; sin pausas >100 ms durante trazo normal. |
| JS inicial comprimido | <250 KiB, excluyendo texturas y chunks diferidos. |
| LCP web | p75 <2.5 s en perfil acordado. |
| Timeline | Mostrar cache inmediatamente; página de servidor p95 <1.5 s en red de referencia. |
| ACK de publicación | p95 <2 s en red estable, excluyendo upload grande. |
| Evento realtime | p95 <1 s desde commit a cliente conectado en prueba regional. |
| Preview | ≤512 KiB; tamaño típico deseado <150 KiB. |
| Drawing JSON comprimido | ≤2 MiB para MVP. |
| Android crash-free | >99% de sesiones durante piloto, segmentado por versión/OEM. |

## Hilo principal y render

- Pointer events no esperan API ni escritura síncrona.
- No parsear documento grande ni calcular hash pesado en render React.
- Mover compresión/hash/export a Web Worker si perfilado muestra jank.
- Reducir allocations por punto; usar buffers y estructuras tipadas.
- Cargar texturas bajo demanda, cachear y liberar cuando no se usan.
- Timeline carga miniaturas lazy y limita concurrent downloads.
- Virtualizar solo cuando el tamaño real de lista lo requiera.
- En WebView, evitar ciclos de animación activos cuando canvas no está visible.

## Perfilado y optimización

Proceso ante una regresión:

1. Reproducir en dispositivo/red identificables.
2. Medir CPU/GPU/memoria/GC/parsing/storage/red; reportar percentiles.
3. Capturar perfil con Android Studio Profiler/Perfetto o herramientas web.
4. Cambiar solo el cuello de botella observado.
5. Reejecutar mismos fixtures/escenas y conservar resultado comparativo.
6. Añadir degradación elegante para hardware menor.

Canvas 2D es el primer renderer. No migrar de entrada a WebGL/WebGPU/CanvasKit: pueden elevar bundle, memoria, complejidad y riesgo de compatibilidad. Mantener una interfaz de renderer para permitir el cambio respaldado por medición.

## Backend y crecimiento

- Un Durable Object por PairSpace; no uno por usuario o dibujo.
- DO hace validación mínima de socket y fanout, no render ni consultas N+1.
- Confirmar persistencia antes del broadcast; cursor permite reparar fanout perdido.
- D1: índices para timeline/eventos, cursor pagination, queries cortas, medir rows read/written y overload.
- Evitar páginas ilimitadas; snapshots cuando replay sea muy antiguo.
- R2 mantiene bytes fuera de DB; cuotas de almacenamiento por PairSpace.
- FCM y GC son jobs reintentables, nunca parte síncrona de ACK de publicación.
- Rate limits y límites de consumo protegen disponibilidad y costos.
- Introducir particiones solo al observar presión sostenida, no como arquitectura preventiva sin datos.

## Red, almacenamiento y costos de payload

```text
bytes por dibujo = documento comprimido + preview + render opcional + metadata/event
tráfico mensual ≈ número dibujos × (uploads + descargas en instalaciones activas)
storage mensual ≈ dibujos retenidos × bytes promedio × versiones conservadas
```

Optimizar previews y requests redundantes primero. Usar hashes/ETag, versiones cacheables y descargas privadas. Nunca compartir cache entre espacios/usuarios sin verificar autorización.

## Señales para cambiar arquitectura

- D1 muestra queue latency/overload o alcanza límites de tamaño/throughput de forma sostenida: migrar adapter de persistencia a DB con capacidad adecuada.
- Realtime requiere SLA/capacidad que el DO no cubra: valorar servicio gestionado o partición por PairSpace.
- Render server-side se vuelve necesario: añadir job workers separados.
- Se aprueba dibujo colaborativo en vivo: diseñar stream de operaciones/CRDT; no improvisar reutilizando eventos de Drawing final.
- Se exige E2EE: rediseñar recuperación/keys y widgets antes de agregarlo.

Evitar desplegar Postgres, Redis, Docker u otra infraestructura mientras no exista una necesidad observada que justifique costo y operación.
