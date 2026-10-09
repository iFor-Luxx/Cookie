# 3. Stack tecnológico y decisiones

## 3.1 Stack candidato

| Capa | Propuesta | Motivo | Alternativa relevante |
|---|---|---|---|
| Lenguaje | TypeScript para web, core y backend. Kotlin limitado a integraciones Android. | Reutilización del dominio y contratos. | Kotlin/Compose si se cambia a cliente Android completamente nativo. |
| Gestión de repo | Bun workspaces + `bun.lock`. | Toolchain rápida y workspace común. | pnpm si compatibilidad de algún SDK/herramienta Android lo exige. |
| UI web | React + TypeScript; componentes shadcn elegidos por producto. | La misma UI React funciona dentro de WebView Capacitor. | React Native implicaría reconstruir la capa de UI. |
| Android | Capacitor y Android Studio; APK desde `apps/android`. | Reutilizar build web y conectarse a APIs nativas mediante plugins. | WebView/PWA sin widget no cumple el requisito del widget nativo. |
| API | Cloudflare Workers (TypeScript) + router pequeño. | Despliegue gestionado, edge, mismo lenguaje. | Node serverless/managed container si se requieren runtime o SDK incompatibles. |
| Validación | Zod o Valibot; escoger una y compartir schemas del protocolo. | Validación runtime en límites. | JSON Schema + Ajv para interoperabilidad más amplia. |
| Realtime | Durable Objects con WebSocket Hibernation. | Actor por PairSpace, orden/localidad de coordinación. | Ably/Pusher para delegar infraestructura a cambio de costo/lock-in. |
| Relacional | D1, esquema SQLite y migraciones SQL. | MVP pequeño, metadatos relacionales, poca operación. | Turso/libSQL o DB gestionada compatible si aparecen necesidades de consulta/escala. |
| Blobs | R2 privado para documento y renders. | Separar bytes grandes de SQL. | S3 compatible, si se necesita portabilidad/región/controles adicionales. |
| Push Android | Firebase Cloud Messaging. | Canal de entrega Android ampliamente integrado. | Push propio no reemplaza FCM/APNs en segundo plano. |
| Render del lienzo | Canvas 2D al inicio, abstracción para backend/renderer futuro. | Menor bundle y amplia compatibilidad. | WebGL/WebGPU o Skia si medición revela límites concretos. |
| Estado local web | IndexedDB a través de interfaz `LocalStore`. | Blobs y cola durable sin base remota. | OPFS para documentos grandes si compatibilidad y backup se verifican. |
| Estado local Android | SQLite plugin + almacenamiento seguro Android Keystore. | Consultas, cola y migraciones nativas. | Room expuesto mediante plugin Kotlin propio para control total. |

## 3.2 Bun y workspace

- El repositorio DEBE fijar una versión de Bun en herramientas/CI y guardar lockfile.
- CI ejecuta instalaciones reproducibles y rechaza modificaciones del lock no revisadas.
- Verificar compatibilidad de Wrangler, Capacitor, Gradle y plugins con la versión Bun seleccionada.
- Capacitor/Gradle pueden requerir herramientas Java/Android independientes; Bun no sustituye Android SDK.
- No publicar paquetes internos prematuramente: workspace local suficiente hasta que exista un consumidor externo.
- Scripts raíz: `check`, `lint`, `typecheck`, `test`, `build:web`, `build:worker`, `build:android`.

## 3.3 Cloudflare: uso y límites arquitectónicos

- Worker procesa requests cortos y stateless; no mantiene conexiones de usuario en memoria propia.
- Durable Object representa sala de un PairSpace y socket coordinator. Usar WebSocket Hibernation cuando sea compatible con el diseño y las métricas.
- D1 guarda metadatos/eventos, no imágenes base64. Considerar concurrencia de consultas por base y límite de tamaño de DB.
- R2 guarda documentos, thumbnails y avatares privados; acceder mediante Worker o URL temporal con alcance reducido.
- Que servicios estén en un mismo proveedor reduce integraciones pero aumenta dependencia y concentra riesgo operativo.
- Free tiers y precios no forman contrato técnico. Poner cuotas de producto, alertas y fallback offline.

## 3.4 Comparación de opciones de backend

| Opción | Ventajas | Costos/riesgos | Cuándo elegir |
|---|---|---|---|
| Workers + DO + D1 + R2 | TS unificado, escala administrada, realtime integrado, costo inicial acotado. | Límites por producto, menor libertad de runtime, vendor coupling, consultar precios cambiantes. | MVP con pequeño equipo y necesidad de realtime. |
| Node + PostgreSQL + object storage | Ecosistema maduro, SQL flexible, portabilidad y tooling amplio. | Más decisiones operativas; Postgres puede implicar costo mínimo y operación adicional. | Cuando consultas/consistencia avanzada o portabilidad valen más que simplicidad. |
| Backend BaaS (Supabase/Firebase) | Auth/storage/realtime listos, velocidad de prototipo. | RLS/reglas complejas, costos al crecer, puede repartir dominio entre proveedores. | Si producto prioriza salir rápido y acepta modelo de proveedor. |
| Realtime gestionado + API propia | Evita operar sockets y ofrece SDK. | Precio recurrente, un proveedor más, datos y authorization duplicados. | Si fanout/uptime se vuelven prioridad superior al control de costo. |

No se debe combinar una base administrada y un sistema realtime distinto sin asignar responsabilidades de orden, autorización, persistencia y recuperación. El backend elegido debe conservar una sola fuente autoritativa para publicación.

## 3.5 Librerías y política de dependencias

- Elegir dependencias por mantenimiento, tamaño, compatibilidad de licencia, soporte móvil y superficie de seguridad.
- Auditar licencia de texturas, fuentes e iconos. No usar recursos de terceros sin permiso compatible con distribución.
- Minimizar plugins Capacitor: cada plugin nativo amplía permisos, superficie de ataque y costo de actualización.
- Mantener lista de dependencias directas/indirectas y revisar avisos de seguridad en cada release.
- No añadir state manager global por defecto; evaluar si la máquina de estados de cada feature lo necesita.
- No confiar en una librería de dibujo “realista” sin probar presión, densidad, rendimiento, bundle y licencia en Android real.

## 3.6 ADR obligatorios

1. ADR-001: estrategia de identidad, credencial de instalación y recuperación.
2. ADR-002: Cloudflare u otra plataforma, estimación de uso y límites que disparan migración.
3. ADR-003: formato canónico de dibujo y requisitos de compatibilidad futura.
4. ADR-004: estrategia de render, texturas propias/licenciadas y presupuesto de FPS.
5. ADR-005: almacenamiento local, plugins Capacitor y manejo de secretos.
6. ADR-006: política de borrado, retención, exportación y recuperación de backups.
7. ADR-007: ejecución de widget, prioridades FCM, privacidad en lock screen.

## 3.7 Gestión de versiones

- API HTTP y WebSocket versionados; cambios aditivos dentro de v1.
- Documento de dibujo lleva `schemaVersion` y migraciones puras.
- Migraciones SQL son append-only y compatibles con al menos la versión anterior del cliente durante despliegue gradual.
- APK declara `versionCode`; backend puede observar versión de protocolo/app, pero no debe bloquear clientes sin política de actualización clara.
- Versiones actualizadas se validan con fixtures de payload de la release anterior.
