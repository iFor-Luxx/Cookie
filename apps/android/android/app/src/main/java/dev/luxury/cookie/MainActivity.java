package dev.luxury.cookie;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import dev.luxury.cookie.updater.UpdatePlugin;
import dev.luxury.cookie.widget.WidgetPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Los plugins propios NO se auto-registran (solo los de npm vía
        // capacitor.plugins.json): sin esto CookieUpdater/CookieWidget
        // no existen para la web. Antes de super.onCreate.
        registerPlugin(UpdatePlugin.class);
        registerPlugin(WidgetPlugin.class);
        super.onCreate(savedInstanceState);
        // Aviso de dibujo recibido (celular B): permiso en Android 13+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                1001
            );
        }
    }
}
