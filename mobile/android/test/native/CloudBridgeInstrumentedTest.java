package com.panthorium.browser;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs only in a separately installed diagnostic application, never the user's Play app. */
@RunWith(AndroidJUnit4.class)
public class CloudBridgeInstrumentedTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue("WebView evaluation completed", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    @Test public void releaseBootstrapRetainsNativeNotificationsOnlyOnTrustedOrigin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            JSONObject state = null;
            for (int i = 0; i < 150; i++) {
                String raw = evaluate(scenario, "JSON.stringify({cloud:location.origin==='https://panthorium.net',ready:document.readyState==='complete',native:window.Capacitor?.isNativePlatform?.()===true,push:typeof window.Capacitor?.Plugins?.PushNotifications?.register==='function',channels:typeof window.Capacitor?.Plugins?.PanthoriumNotifications?.prepareChannels==='function'})");
                if (raw != null && !raw.equals("null")) state = new JSONObject(new JSONArray("[" + raw + "]").getString(0));
                if (state != null && state.optBoolean("cloud") && state.optBoolean("ready")) break;
                Thread.sleep(400);
            }
            assertNotNull(state);
            assertTrue("Production cloud document loaded: " + state, state.optBoolean("cloud"));
            assertTrue("Native bridge survives release navigation: " + state, state.optBoolean("native"));
            assertTrue("Push plugin exported: " + state, state.optBoolean("push"));
            assertTrue("Popup channel plugin exported: " + state, state.optBoolean("channels"));
            evaluate(scenario, "window.__panthoriumProbe='waiting';Capacitor.Plugins.PanthoriumNotifications.prepareChannels().then(v=>window.__panthoriumProbe=v.version===2?'ok':'invalid').catch(()=>window.__panthoriumProbe='error')");
            String result = "";
            for (int i = 0; i < 40; i++) {
                result = evaluate(scenario, "window.__panthoriumProbe");
                if ("\"ok\"".equals(result)) break;
                Thread.sleep(250);
            }
            assertEquals("Native round trip succeeds", "\"ok\"", result);
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadDataWithBaseURL("https://untrusted.invalid/", "<html><body>origin isolation test</body></html>", "text/html", "UTF-8", null));
            Thread.sleep(700);
            assertEquals("Untrusted origin never receives the bridge", "false", evaluate(scenario, "window.Capacitor?.isNativePlatform?.()===true"));
        }
    }
}
