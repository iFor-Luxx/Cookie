package dev.luxury.cookie.widget

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Constraints
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * H6: sincroniza la última preview del historial en background.
 * Trabajo único colapsado (KEEP): ráfagas de push no multiplican descargas.
 * Best-effort: doze, standby, batería y fabricante pueden posponerlo.
 */
class SyncWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    companion object {
        const val UNIQUE_NAME = "cookie-sync"
        private const val PREVIEW_MAX_BYTES = 1024 * 1024

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(
            "CapacitorStorage",
            Context.MODE_PRIVATE,
        )
        val sessionRaw = prefs.getString("cookie.session", null) ?: return Result.failure()
        val apiBase = prefs.getString("cookie.apiBase", null) ?: return Result.failure()
        val session = try {
            JSONObject(sessionRaw)
        } catch (_: Exception) {
            return Result.failure()
        }
        var access = session.optString("accessToken").ifBlank { return Result.failure() }
        val refresh = session.optString("refreshToken").ifBlank { return Result.failure() }
        val spaceId = session.optString("spaceId").ifBlank { return Result.failure() }

        val cached = WidgetCache.load(applicationContext)
        val cursor = cached?.cursor ?: 0
        try {
            var events = getJson(apiBase, "/v1/pair-spaces/$spaceId/events?afterSeq=$cursor", access)
            if (events == null) {
                // Access caducado: rotar una vez y reintentar.
                val rotated = refreshSession(apiBase, refresh, prefs, session) ?: return Result.failure()
                access = rotated
                events = getJson(apiBase, "/v1/pair-spaces/$spaceId/events?afterSeq=$cursor", access)
                    ?: return Result.retry()
            }
            val currentSeq = events.optInt("currentSeq", cursor)
            val snapshot = events.optBoolean("snapshotRequired", false)
            val list = events.optJSONArray("events")
            var relevant = snapshot
            if (list != null) {
                for (i in 0 until list.length()) {
                    val type = list.optJSONObject(i)?.optString("type")
                    if (type == "drawing.created" || type == "drawing.deleted") {
                        relevant = true
                        break
                    }
                }
            }
            if (!relevant) {
                WidgetCache.saveCursor(applicationContext, currentSeq)
                return Result.success()
            }
            // Estrategia simple y robusta: la caché siempre refleja el
            // primero del timeline (el más nuevo). Cubre creado y borrado.
            val timeline = getJson(apiBase, "/v1/pair-spaces/$spaceId/drawings?limit=1", access)
                ?: return Result.retry()
            val drawings = timeline.optJSONArray("drawings")
            if (drawings == null || drawings.length() == 0) {
                WidgetCache.clear(applicationContext)
                WidgetCache.saveCursor(applicationContext, currentSeq)
                CookieWidgetProvider.renderAll(applicationContext)
                return Result.success()
            }
            val first = drawings.getJSONObject(0)
            val drawingId = first.getString("id")
            val createdAt = first.optString("createdAt", "")
            if (cached?.drawingId == drawingId) {
                WidgetCache.saveCursor(applicationContext, currentSeq)
                return Result.success()
            }
            val preview = getBytes(apiBase, "/v1/drawings/$drawingId/preview", access, PREVIEW_MAX_BYTES)
                ?: return Result.retry()
            WidgetCache.save(
                applicationContext,
                CachedDrawing(drawingId = drawingId, createdAt = createdAt, cursor = currentSeq),
                preview,
            )
            CookieWidgetProvider.renderAll(applicationContext)
            return Result.success()
        } catch (_: IOException) {
            return Result.retry()
        } catch (_: Exception) {
            return Result.failure()
        }
    }

    private fun refreshSession(
        apiBase: String,
        refreshToken: String,
        prefs: android.content.SharedPreferences,
        session: JSONObject,
    ): String? {
        val body = postJson(apiBase, "/v1/sessions/refresh", refreshToken, null) ?: return null
        val access = body.optString("accessToken").ifBlank { return null }
        val rotated = body.optString("refreshToken", refreshToken)
        session.put("accessToken", access)
        session.put("refreshToken", rotated)
        prefs.edit().putString("cookie.session", session.toString()).apply()
        return access
    }

    private fun conn(apiBase: String, path: String, token: String): HttpURLConnection {
        val url = URL("$apiBase$path")
        val c = url.openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("Authorization", "Bearer $token")
        c.setRequestProperty("x-protocol-version", "1")
        return c
    }

    private fun getJson(apiBase: String, path: String, token: String): JSONObject? {
        val c = conn(apiBase, path, token)
        try {
            if (c.responseCode == 401) return null
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
            val text = c.inputStream.bufferedReader().readText()
            return JSONObject(text)
        } finally {
            c.disconnect()
        }
    }

    private fun postJson(apiBase: String, path: String, token: String, body: String?): JSONObject? {
        val c = conn(apiBase, path, token)
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            if (body != null) c.outputStream.bufferedWriter().use { it.write(body) }
            if (c.responseCode !in 200..299) return null
            return JSONObject(c.inputStream.bufferedReader().readText())
        } finally {
            c.disconnect()
        }
    }

    private fun getBytes(apiBase: String, path: String, token: String, maxBytes: Int): ByteArray? {
        val c = conn(apiBase, path, token)
        try {
            if (c.responseCode !in 200..299) return null
            val contentLength = c.contentLength
            if (contentLength > maxBytes) return null
            val bytes = c.inputStream.readBytes()
            if (bytes.size > maxBytes) return null
            return bytes
        } finally {
            c.disconnect()
        }
    }
}
