# 10. Seguridad, emparejamiento y privacidad

## Identidad sin registro pesado

La app crea `User` opaco e `Installation` con secreto aleatorio de alta entropía. El nombre y avatar no prueban identidad ni conceden acceso.

- Credencial revocable por instalación.
- Access token de vida corta y refresh/secret protegido por plataforma.
- Web evita bearer duradero en `localStorage`; CSP, output encoding y revisión de dependencias.
- Android protege secretos con Android Keystore mediante implementación/plugin auditado.
- Backend guarda hashes de credenciales; no guarda bearer legible.
- WebSocket usa ticket de un solo uso y pocos segundos; no pone bearer duradero en URL.

## Pairing y recuperación

1. Primer miembro crea PairSpace.
2. Backend genera recovery secret aleatorio, muestra una vez y almacena hash.
3. Primer miembro genera invitación aleatoria, de un solo uso y TTL corto; backend almacena hash.
4. Comparte invite por canal privado. La UI advierte que quien la tenga puede entrar mientras sea válida.
5. Segundo miembro confirma y consume la invitación.
6. Transacción valida expiración, consumo, estado y capacidad antes de crear Membership.
7. Invite no sustituye recovery. Se puede revocar si fue compartida por error.

Recuperación tras reinstalación requiere el secreto guardado fuera del dispositivo o aprobación de una instalación de miembro activo. No se recupera acceso usando nombre o ID. Si ambos miembros pierden instalaciones y secretos, el sistema no puede prometer recuperación: la política debe decidirse antes de producción.

## Threat model

| Amenaza | Control |
|---|---|
| Invite robada | One-time, TTL corto, hash, rate limit, revocación y confirmación. |
| Enumeración de PairSpace | IDs aleatorios, errores indistinguibles, límites por IP/installation. |
| IDOR entre espacios | Comprobar membership y alcance en cada lectura/mutación; test de autorización cruzada. |
| Token robado | Acceso corto, refresh rotation, secure storage, revoke de instalación. |
| XSS web | CSP estricta, contenido escapado, no HTML arbitrario, dependencia auditada. |
| R2 público | Bucket privado, claves server-generated, descarga autorizada/URL temporal. |
| Repetición | Idempotency key, hash de request y consumo atómico de invite. |
| Abuso/costo | Rate limits, cuota bytes/espacio, tamaño de payload, alertas y kill switch. |
| Fuga en logs/push | Nunca loguear dibujo, código, bearer, URL firmada ni token FCM. |
| Dispositivo perdido | Revocar Installation y limpiar push/socket; recovery separado. |
| Cuenta CI comprometida | Separar prod/staging, mínimo privilegio, rotación, secretos fuera del repo. |

## Cifrado y privacidad

- TLS obligatorio para API, WebSocket, upload y descarga.
- Cifrado en reposo provisto por infraestructura; verificar que aplica a DB, bucket y backups.
- El SDD no promete cifrado extremo a extremo: backend puede acceder lógicamente a blobs y derivar miniaturas.
- No usar contenido para publicidad, entrenamiento ni analytics de contenido.
- Recoger nombre, avatar opcional, dibujos elegidos, IDs técnicos, eventos mínimos y token FCM.
- No pedir contactos, ubicación, cámara o micrófono para MVP.
- Definir exportación, retención, borrado, cierre de espacio y periodo de gracia antes del lanzamiento público.
- El widget puede ser visible en lock screen; usuario debe poder ocultar preview.
- Revisar requisitos legales y de tiendas en jurisdicción de lanzamiento cuando se defina.

Si E2EE se convierte en requisito, requiere ADR: claves por espacio, intercambio durante pairing, recuperación, rotación, thumbnails/widget, export y pérdida de capacidad de procesar blobs en servidor. No es un checkbox superficial.

## Seguridad de carga de archivos

- Upload intent corto, de un objeto y con key asignada por servidor.
- Verificar ownership, PairSpace, expiración y no consumo.
- Inspeccionar MIME por contenido real, no solo header; limitar dimensiones, peso y bytes tras descompresión.
- Limitar profundidad y tamaño de JSON; validar schema version.
- No permitir URL de imagen arbitraria para evitar SSRF.
- Verificar checksum antes de asociar objeto al Drawing.
- GC de objetos sin referencia solo después de una ventana que cubra uploads y retries.
