package dev.luxury.cookie.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import dev.luxury.cookie.R

/**
 * H6: widget best-effort. Muestra la última preview confirmada + hora.
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
        fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, CookieWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val cached = WidgetCache.load(context)
            val bitmap = cached?.let { WidgetCache.loadBitmap(context) }
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.cookie_widget)
                if (cached != null && bitmap != null) {
                    views.setImageViewBitmap(R.id.widget_preview, bitmap)
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
