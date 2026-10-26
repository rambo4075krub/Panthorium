package com.panthorium.browser;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PanthoriumNotifications")
public class PanthoriumNotificationsPlugin extends Plugin {
    @PluginMethod
    public void prepareChannels(PluginCall call) {
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel silent = new NotificationChannel("panthorium_popups_silent_v2", "ป๊อบอัพแบบเงียบ", NotificationManager.IMPORTANCE_HIGH);
            silent.setDescription("แสดงป๊อบอัพโดยไม่เล่นเสียง");
            silent.setSound(null, null);
            silent.enableVibration(false);
            silent.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(silent);
            NotificationChannel alerts = new NotificationChannel("panthorium_alerts", "การแจ้งเตือน Panthorium", NotificationManager.IMPORTANCE_HIGH);
            alerts.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(alerts);
        }
        JSObject result = new JSObject();
        result.put("version", 2);
        result.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }
}
