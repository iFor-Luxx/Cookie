package dev.luxury.cookie.push

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.luxury.cookie.widget.SyncWorker

/**
 * H6: recibe data messages mínimos ({spaceId}) y agenda trabajo único.
 * Nunca descarga imágenes ni hace red larga aquí: el callback es corto y
 * Android puede matar el proceso. El trabajo real vive en SyncWorker.
 * Sin google-services.json esta clase existe pero FCM nunca la invoca.
 */
class CookieMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val spaceId = message.data["spaceId"] ?: return
        if (spaceId.isBlank()) return
        // Colapsar ráfagas: el worker reconcilia por cursor al correr.
        try {
            SyncWorker.enqueue(applicationContext)
        } catch (_: Exception) {
            // Sin WorkManager disponible: la app reconcilia al abrir.
        }
    }

    override fun onNewToken(token: String) {
        // Guardar donde la web (TypeScript) lo lea para subirlo al servidor.
        // Misma SharedPreferences que el plugin Capacitor Preferences.
        try {
            applicationContext
                .getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit()
                .putString("cookie.fcmToken", token)
                .apply()
        } catch (_: Exception) {
            // Sin almacenamiento: el token se pierde hasta el próximo refresh.
        }
    }
}
