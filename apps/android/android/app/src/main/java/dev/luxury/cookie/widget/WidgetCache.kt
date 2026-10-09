package dev.luxury.cookie.widget

import android.content.Context
import java.io.File

/**
 * H6/H8: caché del widget. Último documento JSON confirmado + metadatos
 * mínimos. El widget renderiza el documento localmente (máxima calidad);
 * no guarda la preview ni tokens ni URLs firmadas. Escritura atómica.
 */
data class CachedDrawing(
    val drawingId: String,
    val createdAt: String,
    val cursor: Int,
)

private const val PREFS = "CookieWidget"
private const val KEY_DRAWING_ID = "drawingId"
private const val KEY_CREATED_AT = "createdAt"
private const val KEY_CURSOR = "cursor"

object WidgetCache {
    fun documentFile(context: Context): File =
        File(File(context.filesDir, "widget"), "doc.json")

    fun load(context: Context): CachedDrawing? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getString(KEY_DRAWING_ID, null) ?: return null
        return CachedDrawing(
            drawingId = id,
            createdAt = prefs.getString(KEY_CREATED_AT, "") ?: "",
            cursor = prefs.getInt(KEY_CURSOR, 0),
        )
    }

    fun loadDocument(context: Context): String? {
        val file = documentFile(context)
        if (!file.exists()) return null
        return try {
            file.readText(Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    fun save(context: Context, cached: CachedDrawing, docJson: String) {
        val dir = File(context.filesDir, "widget")
        if (!dir.exists()) dir.mkdirs()
        val tmp = File(dir, "doc.json.tmp")
        tmp.writeText(docJson, Charsets.UTF_8)
        val dest = documentFile(context)
        if (!tmp.renameTo(dest)) {
            tmp.delete()
            throw IllegalStateException("No se pudo guardar el documento del widget")
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DRAWING_ID, cached.drawingId)
            .putString(KEY_CREATED_AT, cached.createdAt)
            .putInt(KEY_CURSOR, cached.cursor)
            .apply()
    }

    fun saveCursor(context: Context, cursor: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_CURSOR, cursor)
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        documentFile(context).delete()
    }
}
