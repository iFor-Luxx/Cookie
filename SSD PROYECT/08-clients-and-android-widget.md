# 8. Clientes web y Android

## Web

- React + TypeScript consume `core`, `drawing`, `protocol`, `sync` y `platform-web`.
- IndexedDB guarda drafts, outbox, cursores y cache de previews.
- Evitar `localStorage` para bearer duradero. Service worker/PWA es opcional y no garantiza push/background en todas las plataformas.
- UI traduce comandos/estado a componentes. Shadcn, paleta, fuentes y estilo los elegirá la persona responsable del producto.
- No acceder desde UI directamente a D1/R2, Firebase ni tablas internas.
- Renderizar timeline desde cache local sin esperar carga de red; luego reconciliar.

## Android con Capacitor

- Compilar React dentro de Capacitor; compartir lógica de producto y dibujo con web.
- Versionar el proyecto nativo Android; revisar Gradle, manifest y permisos como código.
- Mantener puente Capacitor mínimo para Secure Storage, registro FCM, deep links y coordinación con widget.
- Kotlin implementa AppWidgetProvider/RemoteViews y FirebaseMessagingService; esto no se puede sustituir por React.
- Validar en dispositivo real stylus, lifecycle, memoria WebView, teclado/IME, back button, intents, consumo y OEM.
- No asumir equivalencia entre “cerrar ventana”, proceso terminado y force-stop. Tras force-stop puede no ejecutarse trabajo hasta volver a abrir.

## Contratos de plataforma

```ts
interface SecureCredentialStore {
  readInstallationSecret(): Promise<string | null>;
  writeInstallationSecret(secret: string): Promise<void>;
  clearInstallationSecret(): Promise<void>;
}
interface LocalRepository {
  saveDraft(draft: Draft): Promise<void>;
  enqueue(command: PublishCommand): Promise<void>;
  loadPending(): Promise<PublishCommand[]>;
  applyRemoteEvent(event: PairEvent): Promise<void>;
}
interface PlatformCapabilities {
  platform: 'web' | 'android';
  supportsStylusPressure: boolean;
  supportsHomeWidget: boolean;
  online(): boolean;
}
```

`core` no importa `window`, Capacitor ni clases Android; las capacidades se inyectan por interfaces.

## Widget Android: arquitectura

El widget usa `AppWidgetProvider`, `RemoteViews` y recursos nativos. No es React dentro del launcher.

1. Backend confirma dibujo y agrega trabajo de push a outbox.
2. FCM envía data message mínimo a instalaciones Android vigentes.
3. `FirebaseMessagingService.onMessageReceived` valida y agenda trabajo único; no descarga imágenes largas dentro del callback corto.
4. WorkManager consulta delta autenticado, descarga preview autorizada y guarda preview, metadata y cursor atómicamente.
5. Actualiza RemoteViews si hay widget activo.
6. Al abrir app/widget, reconcilia cursores para reparar notificaciones perdidas.

## Restricciones que afectan producto

- `updatePeriodMillis` no permite frecuencia menor a 30 minutos; las actualizaciones por eventos/app son otra vía, pero no deben derivar en polling agresivo.
- WorkManager está sujeto a doze, standby, batería, conectividad y fabricante.
- FCM puede retrasarse o no llegar. Usar prioridad alta solo si el contenido cumple las reglas del servicio.
- Force-stop puede detener procesamiento hasta reabrir la app.
- Compromiso de producto: actualización best-effort cuando Android permita procesar; no se garantiza inmediatez.

## Contenido, privacidad y UX

- Mostrar última miniatura confirmada, autor y hora local aproximada.
- Tap abre el Drawing correcto mediante deep link autenticado.
- Mantener la última imagen durante un fallo temporal; no sugerir pérdida de contenido.
- No guardar historial completo, token o URL firmada en widget.
- Definir si contenido aparece en lock screen; default recomendado: configuración explícita de privacidad.
- Al cambiar de PairSpace o cerrar sesión, limpiar cache del espacio anterior.

## Lifecycle

- Foreground: WS activo y delta; al volver de background, validar cursor.
- Background Android: FCM agenda trabajo acotado, que puede ser pospuesto.
- Web `online` solo señala conectividad probable; outbox siempre necesita ACK.
- Inicio de app procesa outbox y cursores en background para no bloquear la primera vista.
