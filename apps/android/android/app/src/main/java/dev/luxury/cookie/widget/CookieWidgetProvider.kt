package dev.luxury.cookie.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.widget.RemoteViews
import dev.luxury.cookie.R
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONObject

/**
 * H6/H8: widget best-effort. Renderiza el último documento JSON a máxima
 * calidad en el tamaño real del widget (nada de thumbnail/imagen).
 * Nunca promete inmediatez: FCM + WorkManager + reconciliación al abrir.
 * Sin updatePeriodMillis (0): sin polling del sistema.
 */
class CookieWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        renderAll(context)
    }

    companion object {
        private var renderKey: String? = null
        private var renderBitmap: Bitmap? = null

        fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, CookieWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val cached = WidgetCache.load(context)
            val doc = try {
                WidgetCache.loadDocument(context)?.let { JSONObject(it) }
            } catch (_: Exception) {
                null
            }
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.cookie_widget)
                if (cached != null && doc != null) {
                    views.setImageViewBitmap(
                        R.id.widget_preview,
                        renderFor(context, manager, id, cached.drawingId, doc),
                    )
                    views.setTextViewText(R.id.widget_caption, captionOf(cached.createdAt))
                    views.setOnClickPendingIntent(
                        R.id.widget_preview,
                        deepLink(context, cached.drawingId),
                    )
                } else {
                    views.setImageViewResource(
                        R.id.widget_preview,
                        android.R.drawable.ic_menu_gallery,
                    )
                    views.setTextViewText(
                        R.id.widget_caption,
                        context.getString(R.string.widget_empty),
                    )
                    views.setOnClickPendingIntent(
                        R.id.widget_preview,
                        deepLink(context, null),
                    )
                }
                manager.updateAppWidget(id, views)
            }
        }

        /** Render bajo demanda según el tamaño real del widget (cache en memoria). */
        private fun renderFor(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            drawingId: String,
            doc: JSONObject,
        ): Bitmap {
            val opts = manager.getAppWidgetOptions(widgetId)
            val density = context.resources.displayMetrics.density
            val widthPx = (opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 250) * density)
                .roundToInt()
            val heightPx = (opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 250) * density)
                .roundToInt()
            val side = min(DrawingRenderer.MAX_SIDE, min(widthPx, heightPx)).coerceAtLeast(64)
            val key = "$drawingId:$side"
            if (key == renderKey && renderBitmap != null) return renderBitmap!!
            val bitmap = DrawingRenderer.renderDocument(widthPx, heightPx, doc)
            renderKey = key
            renderBitmap = bitmap
            return bitmap
        }

        private fun captionOf(createdAt: String): String {
            if (createdAt.isBlank()) return ""
            return try {
                // createdAt ISO-8601; mostrar fecha corta local sin librerías extra.
                createdAt.substring(0, 16).replace("T", " ")
            } catch (_: Exception) {
                ""
            }
        }

        private fun deepLink(context: Context, drawingId: String?): PendingIntent {
            val uri = if (drawingId != null) {
                Uri.parse("cookie://drawing/$drawingId")
            } else {
                Uri.parse("cookie://drawing")
            }
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                setClass(context, Class.forName("dev.luxury.cookie.MainActivity"))
            }
            return PendingIntent.getActivity(
                context,
                if (drawingId != null) drawingId.hashCode() else 0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
