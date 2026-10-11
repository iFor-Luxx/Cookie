package dev.luxury.cookie.widget

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat

// Aviso visible al recibir un dibujo (celular B). El data message de FCM
// no muestra nada solo: SyncWorker reconcilia y, si el dibujo nuevo es de
// otro autor, publica esta notificación. Sin permiso (Android 13+) se omite
// en silencio; el widget sigue actualizándose igual.
object CookieNotifier {
    private const val CHANNEL_ID = "cookie-dibujos"
    private const val NOTIFICATION_ID = 1001

    fun showNewDrawing(context: Context) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Dibujos recibidos",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(
                context,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle("Nuevo dibujo recibido")
            .setContentText("Toca para verlo en la app")
            .setAutoCancel(true)
            .apply { pending?.let { setContentIntent(it) } }
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }
}
