package dev.luxury.cookie.updater

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.firebase.FirebaseApp
import com.google.firebase.database.FirebaseDatabase
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Actualizaciones propias sin Play Store (H-updates): el aviso de versión
// vive en RTDB (solo lectura puntual, sin polling), la descarga va al
// almacenamiento privado (sin permisos, sin data/obb) y la instalación la
// hace PackageInstaller con el prompt del sistema. Sin google-services.json
// todo responde "no disponible" y la app sigue normal.
private const val RELEASES_PATH = "releases/android/latest"
private const val ACTION_INSTALL_STATUS =
    "dev.luxury.cookie.updater.INSTALL_STATUS"

@CapacitorPlugin(name = "CookieUpdater")
class UpdatePlugin : Plugin() {

    private fun installedVersionCode(): Int {
        val pm = context.packageManager
        val pkg = context.packageName
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(
                pkg,
                PackageManager.PackageInfoFlags.of(0),
            ).longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(pkg, 0).versionCode
        }
    }

    private fun apkFile(versionCode: Int): File =
        File(File(context.cacheDir, "updates"), "cookie-$versionCode.apk")

    @PluginMethod
    fun getVersion(call: PluginCall) {
        val ret = JSObject()
        ret.put("versionCode", installedVersionCode())
        call.resolve(ret)
    }

    @PluginMethod
    fun checkUpdate(call: PluginCall) {
        if (FirebaseApp.getApps(context).isEmpty()) {
            val ret = JSObject()
            ret.put("available", false)
            ret.put("reason", "firebase-missing")
            call.resolve(ret)
            return
        }
        val current = installedVersionCode()
        FirebaseDatabase.getInstance().getReference(RELEASES_PATH).get()
            .addOnSuccessListener { snap ->
                val ret = JSObject()
                val code =
                    (snap.child("versionCode").value as? Number)?.toLong() ?: 0L
                val tag = snap.child("tag").getValue(String::class.java) ?: ""
                val apkUrl = snap.child("apkUrl").getValue(String::class.java) ?: ""
                val sha256 = snap.child("sha256").getValue(String::class.java) ?: ""
                val notes = snap.child("notes").getValue(String::class.java) ?: ""
                val valid =
                    code > current &&
                        tag.isNotBlank() &&
                        apkUrl.startsWith("https://") &&
                        sha256.matches(Regex("[0-9a-fA-F]{64}"))
                ret.put("available", valid)
                if (valid) {
                    ret.put("currentVersion", current)
                    ret.put("versionCode", code)
                    ret.put("tag", tag)
                    ret.put("apkUrl", apkUrl)
                    ret.put("sha256", sha256.lowercase())
                    ret.put("notes", notes)
                }
                call.resolve(ret)
            }
            .addOnFailureListener { e ->
                call.reject("No se pudo consultar la actualización", e)
            }
    }

    @PluginMethod
    fun downloadUpdate(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("Falta url")
        val sha256 = call.getString("sha256") ?: return call.reject("Falta sha256")
        val versionCode = call.getInt("versionCode", -1)
        if (!url.startsWith("https://") ||
            !sha256.matches(Regex("[0-9a-fA-F]{64}")) ||
            versionCode <= 0
        ) {
            call.reject("Parámetros inválidos")
            return
        }
        Thread {
            try {
                val dir = File(context.cacheDir, "updates")
                dir.mkdirs()
                val out = apkFile(versionCode)
                if (out.exists()) out.delete()
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    setRequestProperty("User-Agent", "CookieUpdater")
                }
                conn.connect()
                if (conn.responseCode !in 200..299) {
                    throw IllegalStateException("HTTP ${conn.responseCode}")
                }
                val total = conn.contentLengthLong
                val digest = MessageDigest.getInstance("SHA-256")
                conn.inputStream.use { input ->
                    out.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        var read = 0L
                        var last = -1
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            output.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            read += n
                            if (total > 0) {
                                val p = ((read * 100) / total).toInt()
                                if (p != last) {
                                    last = p
                                    val ev = JSObject()
                                    ev.put("progress", p)
                                    notifyListeners("downloadProgress", ev)
                                }
                            }
                        }
                    }
                }
                val hex = digest.digest().joinToString("") { "%02x".format(it) }
                if (!hex.equals(sha256, ignoreCase = true)) {
                    out.delete()
                    throw SecurityException("SHA-256 no coincide")
                }
                val ret = JSObject()
                ret.put("bytes", out.length())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message ?: "Descarga fallida", e)
            }
        }.start()
    }

    @PluginMethod
    fun canInstall(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", context.packageManager.canRequestPackageInstalls())
        call.resolve(ret)
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun installUpdate(call: PluginCall) {
        val versionCode = call.getInt("versionCode", -1)
        val apk = if (versionCode > 0) apkFile(versionCode) else null
        if (apk == null || !apk.exists()) {
            call.reject("Primero descarga la actualización")
            return
        }
        try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL,
            )
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite("apk", 0, -1).use { out ->
                    apk.inputStream().use { input -> input.copyTo(out) }
                    session.fsync(out)
                }
                val intent = Intent(context, UpdateStatusReceiver::class.java)
                    .setAction(ACTION_INSTALL_STATUS)
                val pi = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                session.commit(pi.intentSender)
            }
            call.resolve(JSObject())
        } catch (e: Exception) {
            call.reject(e.message ?: "No se pudo instalar", e)
        }
    }
}
