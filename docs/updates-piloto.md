# Updates propios sin Play Store (piloto, $0)

La app avisa sola cuando hay APK nuevo. Sin servidor, sin polling:
el aviso vive en Firebase RTDB (una lectura puntual al entrar al
estudio) y el APK vive en un GitHub Release. Todo manual.

## Una sola vez

### 1. Proyecto Firebase (consola, 5 min)
1. Crea proyecto (sin Analytics) y una **Realtime Database** en tu región.
2. Reglas (solo el nodo de versión legible; escribir solo tú):
```json
{
  "rules": {
    "releases": {
      "android": {
        "latest": { ".read": true, ".write": false }
      }
    }
  }
}
```
La consola escribe como admin (las reglas no te bloquean a ti).
3. Android → registra `dev.luxury.cookie` → descarga
`google-services.json` → ponlo en `apps/android/android/app/`
(gitignored, jamás se commitea). Sin ese archivo la app compila
igual pero el chequeo responde “no disponible”.

### 2. Keystore piloto y versionado (`local.properties`, gitignored)
```properties
cookie.versionCode=2
cookie.versionName=1.1
cookie.keystore.file=C:/ruta/cookie-piloto.jks
cookie.keystore.storePassword=...
cookie.keystore.keyAlias=cookie
cookie.keystore.keyPassword=...
```
Generarlo (JDK 21, una sola vez, guarda copia fuera del repo):
```sh
keytool -genkeypair -keystore cookie-piloto.jks -alias cookie \
  -keyalg RSA -keysize 2048 -validity 9125
```
**Reglas duras:** misma firma siempre (Android rechaza otro firmante)
y `versionCode` estrictamente mayor en cada release. Los 2 APK del
piloto deben salir de la misma máquina (o mismo keystore).

## Cada release (5 min, a mano)
1. Sube `cookie.versionCode` (+1) y `versionName` en `local.properties`.
2. `bun run build:android` → `assembleDebug` (JDK 21) → APK.
3. En github.com crea el release `android-N` y **arrastra el APK**.
4. `sha256sum app-debug.apk` (o `Get-FileHash` en Windows).
5. En la consola RTDB escribe el nodo (exacto):
```json
"releases": { "android": { "latest": {
  "versionCode": 2,
  "tag": "android-2",
  "apkUrl": "https://github.com/iFor-Luxx/Cookie/releases/download/android-2/app-debug.apk",
  "sha256": "<64 hex>",
  "notes": "Qué cambia, corto"
} } }
```
6. En un celular con la versión vieja: abre Historial → debe salir
“Hay actualización” → Descargar → Instalar (activa “apps
desconocidas” para Cookie una sola vez).

## Rollback
Apunta el nodo al release anterior (nada se borra) o sube
`versionCode` mayor con el build viejo. Los datos se conservan
(misma firma, sin desinstalar).

## Límites honestos
- Instalación nunca 100% silenciosa: el sistema pide 1–2 taps.
- Play Protect puede avisar “app desconocida” → instalar igual.
- Xiaomi/Oppo agresivos: descargar con la app abierta.
- Sin `google-services.json` no hay chequeo (la app sigue normal).
