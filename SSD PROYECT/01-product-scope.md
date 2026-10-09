# 1. Producto y alcance

## 1.1 Propósito

Construir una aplicación privada para que dos personas se envíen dibujos y consulten un historial común desde navegador de PC y Android. El producto debe dar una sensación inmediata al dibujar y publicar, conservar los datos publicados en la nube y seguir siendo útil cuando la conexión se interrumpe.

## 1.2 Objetivos del MVP

1. Emparejar dos personas sin un registro largo. El nombre visible es obligatorio; foto opcional.
2. Crear un espacio compartido, denominado **PairSpace**, con un máximo inicial de dos miembros activos.
3. Publicar dibujos inmutables y mostrarlos en un historial común ordenado por el servidor.
4. Sincronizar en tiempo real las sesiones activas, con recuperación completa tras desconexión.
5. Mantener borradores y publicaciones pendientes localmente hasta que el backend confirme.
6. Usar herramientas con apariencia material: grafito, lápiz de color y rotulador. Acuarela se pospone.
7. Actualizar un widget Android nativo en respuesta a un dibujo entrante, sujeto a las restricciones del sistema.
8. Mantener dominio, protocolos y motor de dibujo en paquetes TypeScript independientes de las UIs.

## 1.3 Fuera del MVP

- Grupos, perfiles públicos, búsqueda de usuarios, feed público o funciones sociales abiertas.
- Edición colaborativa simultánea de un mismo lienzo.
- Sincronización de cada trazo durante el dibujo. El MVP sincroniza borradores localmente y piezas al publicar.
- Capas, importación de imágenes, animación de trazos o herramientas profesionales.
- Acuarela realista. Se añadirá después de validar el motor de pinceles y el rendimiento.
- Garantía de entrega push en segundos o actualización instantánea del widget.
- Diseño visual, paleta y fuentes prescritas por este SDD. La persona dueña del producto elegirá shadcn, estilos y tokens visuales.
- Cifrado extremo a extremo en la primera entrega. Si se convierte en requisito, debe diseñarse antes de producción por el impacto en recuperación, miniaturas y widget.

## 1.4 Requisitos funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| FR-01 | Crear perfil con nombre de 1 a 32 caracteres y foto opcional. | MUST |
| FR-02 | Crear PairSpace y generar invitación aleatoria de un solo uso. | MUST |
| FR-03 | Consumir invitación de forma atómica y vincular el segundo usuario. | MUST |
| FR-04 | Consultar timeline compartido con paginación por cursor. | MUST |
| FR-05 | Dibujar, deshacer/rehacer, guardar borrador y publicar. | MUST |
| FR-06 | Persistir documento de dibujo, miniatura y metadatos antes del ACK. | MUST |
| FR-07 | Propagar eventos a clientes conectados y reconciliar clientes offline. | MUST |
| FR-08 | Mantener una cola durable local, con reintentos idempotentes. | MUST |
| FR-09 | Desvincular/revocar una instalación sin borrar el historial del PairSpace. | MUST |
| FR-10 | Recuperar acceso mediante secreto independiente o aprobación de un miembro. | MUST |
| FR-11 | Intentar actualización del widget Android con FCM + trabajo en background permitido. | MUST |
| FR-12 | Mostrar estado de sincronización comprensible: local, pendiente, enviado, confirmado o error. | MUST |

## 1.5 Requisitos no funcionales

- **Rendimiento:** el input del puntero no espera a red, React ni almacenamiento persistente.
- **Fluidez:** objetivo de 55–60 FPS en equipos de referencia, con degradación controlada en dispositivos modestos.
- **Integridad:** no perder dibujos confirmados; no duplicar por reintentos.
- **Seguridad:** cada lectura y mutación comprueba instalación, membresía y alcance del recurso.
- **Escalabilidad:** la sincronización y el almacenamiento deben poder crecer por PairSpace sin un proceso central stateful único.
- **Mantenibilidad:** dependencias con dirección clara; UI no contiene reglas de autorización ni lógica de sincronización.
- **Accesibilidad:** controles operables por teclado, foco perceptible, nombres accesibles y targets táctiles adecuados.
- **Privacidad:** los dibujos son privados; telemetría no incluye contenido ni credenciales.

## 1.6 Vocabulario

| Término | Definición |
|---|---|
| PairSpace | Espacio de colaboración con historia compartida y hasta dos miembros en MVP. |
| User | Identidad lógica asociada a una persona y perfil. |
| Installation | Una instalación concreta en navegador o Android, con credencial revocable. |
| Drawing | Dibujo publicado, inmutable, con documento vectorial y renders derivados. |
| Draft | Dibujo local que aún no se ha publicado. |
| Event sequence (`seq`) | Cursor monotónico de eventos dentro de un PairSpace. |
| Core | Paquetes TypeScript con dominio, casos de uso, protocolo, motor y sincronización sin UI. |
| Adapter | Implementación de puertos del core para web, Capacitor o servidor. |
