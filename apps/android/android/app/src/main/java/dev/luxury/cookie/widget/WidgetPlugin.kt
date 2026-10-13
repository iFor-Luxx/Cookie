package dev.luxury.cookie.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Puente web → widget (celular B con la app abierta): la web detecta el
// dibujo nuevo por realtime y lo pinta al instante, sin esperar al push
// FCM + WorkManager. Best-effort: si falla, el SyncWorker lo repara.
// Registrar en MainActivity (los plugins propios no se auto-registran).
private const val DOC_MAX_BYTES = 512 * 1024

@CapacitorPlugin(name = "CookieWidget")
class WidgetPlugin : Plugin() {

    @PluginMethod
    fun refreshWidget(call: PluginCall) {
        val drawingId = call.getString("drawingId")
            ?: return call.reject("Falta drawingId")
        val createdAt = call.getString("createdAt") ?: ""
        val cursor = call.getInt("cursor", 0) ?: 0
        val doc = call.getString("doc")
            ?: return call.reject("Falta doc")
        if (
            drawingId.isBlank() ||
            doc.toByteArray(Charsets.UTF_8).size > DOC_MAX_BYTES
        ) {
            call.reject("Parámetros inválidos")
            return
        }
        try {
            WidgetCache.save(
                context,
                CachedDrawing(drawingId = drawingId, createdAt = createdAt, cursor = cursor),
                doc,
            )
            CookieWidgetProvider.renderAll(context)
            call.resolve(JSObject())
        } catch (e: Exception) {
            call.reject("No se pudo actualizar el widget", e)
        }
    }

    @PluginMethod
    fun clearWidget(call: PluginCall) {
        try {
            WidgetCache.clear(context)
            CookieWidgetProvider.renderAll(context)
            call.resolve(JSObject())
        } catch (e: Exception) {
            call.reject("No se pudo limpiar el widget", e)
        }
    }
}
