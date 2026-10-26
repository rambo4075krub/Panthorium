package com.panthorium.browser;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSExport;
import com.getcapacitor.PluginHandle;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONObject;

/** Export the native runtime before scripts run on the reviewed cloud origin. */
public final class PanthoriumCloudBridge {
    private static final String CLOUD_ORIGIN = __PANTHORIUM_CLOUD_ORIGIN__;

    private PanthoriumCloudBridge() {}

    public static void install(Bridge bridge) {
        // Older WebViews use Capacitor's existing HTML-response injection.
        // Modern WebViews inject only on appUrl (localhost in release builds),
        // so allowNavigation alone does not preserve plugins after navigation.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        try {
            ArrayList<PluginHandle> plugins = new ArrayList<>();
            for (String id : new String[]{"CapacitorCookies", "CapacitorHttp", "WebView", "PushNotifications", "PanthoriumNotifications"}) {
                PluginHandle plugin = bridge.getPlugin(id);
                if (plugin != null) plugins.add(plugin);
            }
            String script = "if (!window.Capacitor?.Plugins?.PanthoriumNotifications) {\n"
                + JSExport.getGlobalJS(bridge.getContext(), bridge.getConfig().isLoggingEnabled(), bridge.isDevMode())
                + "\nwindow.WEBVIEW_SERVER_URL=" + JSONObject.quote(bridge.getLocalUrl()) + ";\n"
                + JSExport.getBridgeJS(bridge.getContext()) + "\n"
                + JSExport.getPluginJS(plugins) + "\n}";
            WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), script, Collections.singleton(CLOUD_ORIGIN));
        } catch (Exception error) {
            android.util.Log.e("Panthorium", "Cloud notification bridge could not be installed");
        }
    }
}
