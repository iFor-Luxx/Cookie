# AGENTS.md — Cookie (dibujo compartido, 2 personas)

Fuente de verdad: `SSD PROYECT/` (v1.1, 12 caps). Ante duda, manda SDD §2 arquitectura, §4 backend, §6 sync.

## Comandos (Bun only, no npm/pnpm)

```sh
bun install --frozen-lockfile
bun run check      # biome + tsc + tests
bun run lint       # biome check
bun run typecheck  # tsc --noEmit por workspace
bun run test       # vitest run
bun run build:web  # vite build apps/web
bun run build:worker  # wrangler deploy --dry-run / build server
bun run build:android # web build + cap sync
```

Orden CI: `lint -> typecheck -> test -> build`.

## Estructura (H0-H1)

```text
apps/web/         # ÚNICA UI React+Vite+TS. Tailwind v4, shadcn, lucide
apps/android/     # Wrapper Capacitor, SIN UI propia. Reusa apps/web/dist
packages/core     # dominio puro: PairSpace, Membership, Drawing, Draft, Installation
packages/protocol # schemas zod v1 HTTP/WS + tipos. schemaVersion: 1
packages/drawing  # modelo puntos/trazos, DrawingEngine, sin DOM/React
packages/sync     # outbox, cursors, retries. Determinista (reloj/transporte inyectados)
packages/storage  # interfaces + codecs, sin cloud SDK
packages/ui       # re-export shadcn puros, sin reglas dominio
packages/platform-web / platform-capacitor  # implementan puertos core
server/api realtime(PairRoom DO) jobs db/   # Worker delgado -> use case -> repo
infra/wrangler firebase/  docs/adr/
```

## Reglas duras

- TS-only: `allowJs:false`. Cero `.js/.jsx` en src. `bun.lock` versionado.
- Deps apuntan a core: `apps/*, server/api -> core+protocol+drawing+sync`. `core` NO importa React, DOM, Capacitor, Cloudflare, D1, R2, Firebase. Capacidades vía puertos (`SecureCredentialStore`, `LocalRepository`, `PlatformCapabilities` §8).
- Dibujo publicado = inmutable. Corrección = nueva publicación (salvo tombstone).
- ACK solo tras commit D1 (Drawing+Event+Idempotency). WS/DO es fanout, no verdad. Replay por `seq`, snapshot si `CURSOR_EXPIRED`.
- Mutaciones reintentables llevan `Idempotency-Key` (misma key+mismo hash = mismo resultado; distinto hash = `409`).
- Tailwind v4: `@import "tailwindcss"` en `apps/web/src/index.css`. Tokens oklch ahí son contrato visual, no cambiar sin pedir.
- Fuentes bundle local (`apps/web/public/fonts/` → `dist/fonts/`, `@font-face`, preload): `Instrument Serif` → `--font-serif` / display; `Geist Pixel Square` → `--font-pixel` (ÚNICA variante pixel). `--font-sans` se mantiene. Nada de CDN en runtime (APK offline).
- UI: shadcn `new-york`, `cn()` en `lib/utils.ts`, iconos `lucide-react`. Nada de emojis como iconos.
- R2/D1/FCM nunca desde UI. Keys R2 server-generated. Sin base64 en SQL/WS/logs/push.
- Auth: bearer corto en memoria, refresh en store seguro (web: no `localStorage`; android: Keystore vía plugin). WS con ticket 1-uso segundos. Hashes en backend, nunca secretos en logs.
- Widget/FCM = best-effort (doze/OEM/force-stop). No prometer instantáneo. Mostrar última preview + timestamp.
- Android: `minSdk 29` (Android 10+), `compile/target 35`. Proyecto nativo `apps/android/android/` VERSIONADO (variables.gradle, manifest, Kotlin). Solo `local.properties` (sdk.dir) y `*/build/` van gitignored.
- Build APK: Gradle 8.14 NO corre en Java 25 (JBR bundled del Studio actual). Para `assembleDebug` usar JDK 21 (`JAVA_HOME` o `org.gradle.java.home`), con `ANDROID_HOME=%LOCALAPPDATA%/Android/Sdk`.
- Al comenzar cada mensaje debes de decir "Lux" esto es OBLIGATORIO en cualquier mensaje
