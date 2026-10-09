package dev.luxury.cookie.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/**
 * H6: caché del widget. Última preview confirmada + metadatos mínimos.
 * Sin historial, sin tokens, sin URLs firmadas. Escritura atómica (tmp+rename).
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
    fun previewFile(context: Context): File =
        File(File(context.filesDir, "widget"), "preview.png")

    fun load(context: Context): CachedDrawing? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getString(KEY_DRAWING_ID, null) ?: return null
        return CachedDrawing(
            drawingId = id,
            createdAt = prefs.getString(KEY_CREATED_AT, "") ?: "",
            cursor = prefs.getInt(KEY_CURSOR, 0),
        )
    }

    fun loadBitmap(context: Context): Bitmap? {
        val file = previewFile(context)
        if (!file.exists()) return null
        return BitmapFactory.decodeFile(file.absolutePath)
    }

    fun save(context: Context, cached: CachedDrawing, previewPng: ByteArray) {
        val dir = File(context.filesDir, "widget")
        if (!dir.exists()) dir.mkdirs()
        val tmp = File(dir, "preview.png.tmp")
        tmp.writeBytes(previewPng)
        val dest = previewFile(context)
        if (!tmp.renameTo(dest)) {
            tmp.delete()
            throw IllegalStateException("No se pudo guardar la preview del widget")
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
        previewFile(context).delete()
    }
}
