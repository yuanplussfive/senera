package ai.senera.mobile;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.URI;
import java.net.HttpURLConnection;
import java.net.UnknownHostException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.NoRouteToHostException;
import javax.net.ssl.SSLException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(
    name = "SeneraDeviceSession",
    permissions = @Permission(alias = "legacyDownloads", strings = Manifest.permission.WRITE_EXTERNAL_STORAGE)
)
public class SeneraDeviceSessionPlugin extends Plugin {
    private final ConcurrentHashMap<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService network = java.util.concurrent.Executors.newFixedThreadPool(2);
    private int requestTimeoutMs;
    private int responseMaxBytes;

    @Override public void load() {
        requestTimeoutMs = getConfig().getInt("requestTimeoutSeconds", 0) * 1000;
        responseMaxBytes = getConfig().getInt("responseMaxBytes", 0);
        if (requestTimeoutMs <= 0 || responseMaxBytes <= 0) throw new IllegalStateException("Device transport limits are missing from the packaged configuration.");
    }

    @Override protected void handleOnDestroy() {
        for (HttpURLConnection connection : requests.values()) connection.disconnect();
        requests.clear(); network.shutdownNow();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String value = call.getString("url"), method = call.getString("method", "GET"), id = call.getString("id");
        if (!isDeviceUrl(value) || id == null) { call.reject("Invalid device address.", "invalid_response"); return; }
        URI uri = URI.create(value);
        if (!(uri.getPath().startsWith("/api/auth/devices/") || uri.getPath().equals("/api/auth/session")) ||
            !(method.equals("GET") || method.equals("POST") || method.equals("DELETE"))) {
            call.reject("Invalid device authentication route.", "invalid_response"); return;
        }
        final HttpURLConnection connection;
        try { connection = (HttpURLConnection) uri.toURL().openConnection(); }
        catch (Exception failure) { call.reject("Invalid device address.", "invalid_response", failure); return; }
        requests.put(id, connection);
        network.execute(() -> {
            try {
                if (requests.get(id) != connection) { call.reject("Connection cancelled.", "request_cancelled"); return; }
                connection.setConnectTimeout(requestTimeoutMs);
                connection.setReadTimeout(requestTimeoutMs);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(method);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Origin", "http".equals(uri.getScheme()) ? origin(uri) : origin(URI.create(getBridge().getLocalUrl())));
                String cookie = CookieManager.getInstance().getCookie(value);
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                String csrf = call.getString("csrfToken");
                if (csrf != null) connection.setRequestProperty("X-Senera-Csrf", csrf);
                String body = call.getString("body");
                if (body != null) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { call.reject("Authentication endpoint redirected.", "unexpected_redirect"); return; }
                try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int read;
                    while (input != null && (read = input.read(buffer)) != -1) {
                        if (output.size() + read > responseMaxBytes) {
                            call.reject("Authentication response is too large.", "response_too_large"); return;
                        }
                        output.write(buffer, 0, read);
                    }
                    JSObject result = new JSObject(); result.put("status", status);
                    result.put("body", output.toString(StandardCharsets.UTF_8.name())); call.resolve(result);
                }
            } catch (Exception failure) {
                String code = failure instanceof UnknownHostException ? "dns_failed" : failure instanceof SocketTimeoutException ? "connection_timeout" :
                    failure instanceof SSLException ? "tls_failed" : failure instanceof NoRouteToHostException ? "network_unreachable" :
                    failure instanceof ConnectException ? "connection_refused" : "network_failed";
                call.reject("Device connection failed.", code, failure);
            } finally {
                requests.remove(id);
                connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void cancelRequest(PluginCall call) {
        String id = call.getString("id");
        HttpURLConnection connection = id == null ? null : requests.remove(id);
        if (connection != null) connection.disconnect();
        call.resolve();
    }
    @PluginMethod
    public void getDeviceName(PluginCall call) {
        JSObject result = new JSObject();
        result.put("name", Build.MODEL.startsWith(Build.MANUFACTURER) ? Build.MODEL : Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(result);
    }

    @PluginMethod
    public void setCookie(PluginCall call) {
        String url = call.getString("url");
        String cookie = call.getString("cookie");
        boolean lan = isDeviceUrl(url) && "http".equals(URI.create(url).getScheme());
        String cookieName = getConfig().getString(lan ? "lanCookieName" : "cookieName");
        if (!isDeviceUrl(url) || cookie == null || cookieName == null || !cookie.startsWith(cookieName + "=") ||
            cookie.contains("\r") || cookie.contains("\n") || !cookie.contains("; HttpOnly") ||
            (lan ? !cookie.contains("; SameSite=Strict") || cookie.contains("; Secure") :
                !cookie.contains("; Secure") || !cookie.contains("; SameSite=None")) || cookie.toLowerCase(java.util.Locale.ROOT).contains("domain=")) {
            call.reject("Invalid device session cookie.");
            return;
        }
        getActivity().runOnUiThread(() -> CookieManager.getInstance().setCookie(url, cookie, accepted -> {
            if (!accepted) { call.reject("WebView rejected the device session."); return; }
            CookieManager.getInstance().flush();
            call.resolve();
        }));
    }

    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        getActivity().startActivity(new Intent(getContext(), ConnectionSettingsActivity.class));
        call.resolve();
    }

    @PluginMethod
    public void openWebClient(PluginCall call) {
        String url = call.getString("url");
        String server = call.getString("serverUrl");
        if (!sameOrigin(url, server)) { call.reject("Client must use the paired server."); return; }
        var activity = getActivity();
        activity.runOnUiThread(() -> {
            if (ChannelClientActivity.hasOpenClient(activity.getTaskId(), server)) { call.resolve(); return; }
            // A restored launcher's async login must not open a new document over
            // a child client or its external file picker. Wait for the launcher to own focus.
            var lifecycle = activity.getLifecycle();
            if (lifecycle.getCurrentState() == androidx.lifecycle.Lifecycle.State.DESTROYED) {
                call.reject("The connection window was closed.");
                return;
            }
            androidx.lifecycle.LifecycleEventObserver ready = new androidx.lifecycle.LifecycleEventObserver() {
                @Override public void onStateChanged(androidx.lifecycle.LifecycleOwner owner, androidx.lifecycle.Lifecycle.Event event) {
                    if (event == androidx.lifecycle.Lifecycle.Event.ON_DESTROY) {
                        lifecycle.removeObserver(this);
                        call.reject("The connection window was closed.");
                    } else if (lifecycle.getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
                        lifecycle.removeObserver(this);
                        if (!ChannelClientActivity.hasOpenClient(activity.getTaskId(), server)) {
                            Intent intent = new Intent(activity, ChannelClientActivity.class);
                            intent.putExtra("url", url);
                            intent.putExtra("bundledConsole", Boolean.TRUE.equals(call.getBoolean("bundledConsole", false)));
                            intent.putExtra("restorePosition", Boolean.TRUE.equals(call.getBoolean("bundledConsole", false)));
                            intent.putExtra("rememberPosition", true);
                            activity.startActivity(intent);
                        }
                        call.resolve();
                    }
                }
            };
            lifecycle.addObserver(ready);
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (!sameOrigin(url, call.getString("serverUrl"))) { call.reject("Download must use the paired server."); return; }
        if (needsDownloadPermission(getContext())) {
            requestPermissionForAlias("legacyDownloads", call, "downloadPermissionResult");
            return;
        }
        try { enqueueDownload(getContext(), url, call.getString("fileName")); call.resolve(); }
        catch (RuntimeException failure) { call.reject("Unable to start the download.", failure); }
    }

    @PermissionCallback
    private void downloadPermissionResult(PluginCall call) {
        if (needsDownloadPermission(getContext())) {
            call.reject("Storage permission is required to download on Android 8 and 9.");
            return;
        }
        download(call);
    }

    static boolean needsDownloadPermission(Context context) {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    static void enqueueDownload(Context context, String url, String name) {
        enqueueDownload(context, url, name, true);
    }

    static void enqueueDownload(Context context, String url, String name, boolean credentials) {
        String fileName = name == null ? URLUtil.guessFileName(url, null, null) : name;
        fileName = fileName.replaceAll("[\\\\/\\p{Cntrl}]", "_");
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        String cookie = credentials ? CookieManager.getInstance().getCookie(url) : null;
        if (cookie != null) request.addRequestHeader("Cookie", cookie);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        context.getSystemService(DownloadManager.class).enqueue(request);
    }

    static boolean isDeviceUrl(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (host == null || uri.getUserInfo() != null || uri.getFragment() != null || uri.getPort() > 65535) return false;
            if ("https".equals(uri.getScheme())) return !host.equals("localhost") && !host.equals("127.0.0.1") && !host.equals("[::1]") && !host.equals("0.0.0.0") && !host.equals("[::]");
            if (!"http".equals(uri.getScheme())) return false;
            String[] parts = host.split("\\.");
            if (parts.length != 4) return false;
            int[] values = new int[4];
            for (int i = 0; i < 4; i++) {
                if (!parts[i].matches("[0-9]{1,3}")) return false;
                values[i] = Integer.parseInt(parts[i]); if (values[i] > 255) return false;
            }
            return values[0] == 10 || (values[0] == 172 && values[1] >= 16 && values[1] <= 31) || (values[0] == 192 && values[1] == 168);
        }
        catch (RuntimeException failure) { return false; }
    }

    private static String origin(URI uri) {
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }

    static boolean sameOrigin(String value, String server) {
        if (!isDeviceUrl(value) || !isDeviceUrl(server)) return false;
        URI first = URI.create(value), second = URI.create(server);
        int firstPort = first.getPort() < 0 ? ("https".equals(first.getScheme()) ? 443 : 80) : first.getPort();
        int secondPort = second.getPort() < 0 ? ("https".equals(second.getScheme()) ? 443 : 80) : second.getPort();
        return first.getScheme().equals(second.getScheme()) && first.getHost().equalsIgnoreCase(second.getHost()) && firstPort == secondPort;
    }
}
