package dev.luxury.cookie.updater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.widget.Toast

// Resultado del PackageInstaller: en éxito el sistema reemplaza la app;
// en fallo se avisa (la app sigue intacta, nada se borra).
class UpdateStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)
        if (status == PackageInstaller.STATUS_SUCCESS) return
        val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Toast.makeText(
            context.applicationContext,
            msg ?: "No se pudo instalar la actualización",
            Toast.LENGTH_LONG,
        ).show()
    }
}
