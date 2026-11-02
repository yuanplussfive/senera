package ai.senera.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.IOException;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.stream.Collectors;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Origin-scoped message port shared by the console and QQ; never exposes the app's Capacitor bridge. */
final class WebClientHost implements AutoCloseable {
    private final ChannelClientActivity activity;
    private final String serverUrl;
    private final WebClientSockets sockets;
    private final Consumer<String> openClient;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final Map<String, SavedFile> transfers = new HashMap<>();
    private final ActivityResultLauncher<String> savePicker;
    private SaveRequest pendingSave;
    private boolean closed;
    private long documentGeneration;

    private record SavedFile(Uri uri, OutputStream stream) {}
    private record SaveRequest(String id, JavaScriptReplyProxy reply, long generation) {}

    WebClientHost(ChannelClientActivity activity, String serverUrl, Consumer<String> openClient) {
        this.activity = activity;
        this.serverUrl = serverUrl;
        this.sockets = new WebClientSockets(activity, serverUrl);
        this.openClient = openClient;
        savePicker = activity.registerForActivityResult(new ActivityResultContracts.CreateDocument("*/*"), uri -> {
            SaveRequest request = pendingSave;
            pendingSave = null;
            if (request == null || closed || request.generation != documentGeneration) {
                if (uri != null) discard(new SavedFile(uri, null));
                return;
            }
            if (uri == null) { respond(request.reply, request.id, null, "File saving was cancelled."); return; }
            files.execute(() -> {
                try {
                    String transferId = UUID.randomUUID().toString();
                    OutputStream stream = activity.getContentResolver().openOutputStream(uri, "wt");
                    if (stream == null) throw new IOException("Unable to open the selected file.");
                    transfers.put(transferId, new SavedFile(uri, stream));
                    respond(request.reply, request.id, new JSONObject().put("transferId", transferId), null);
                } catch (Exception failure) {
                    discard(new SavedFile(uri, null));
                    respond(request.reply, request.id, null, failure.toString());
                }
            });
        });
    }

    void install(WebView view) throws IOException {
        java.net.URI server = java.net.URI.create(serverUrl);
        Set<String> origins = Collections.singleton(server.getScheme() + "://" + server.getRawAuthority());
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, "seneraNative", origins, (webView, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !SeneraDeviceSessionPlugin.sameOrigin(origin.toString(), serverUrl)) return;
                String id = null;
                try {
                    JSONObject request = new JSONObject(message.getData());
                    id = request.getString("id");
                    handle(id, request.getString("action"), request.getJSONObject("params"), reply);
                } catch (Exception failure) { respond(reply, id, null, failure.toString()); }
            });
        } else throw new IOException("Update Android System WebView to use this application.");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try (var script = new BufferedReader(new InputStreamReader(activity.getAssets().open("senera-host.js"), StandardCharsets.UTF_8))) {
                WebViewCompat.addDocumentStartJavaScript(view, script.lines().collect(Collectors.joining("\n")), origins);
            }
        } else throw new IOException("Update Android System WebView to use this application.");
    }

    private void handle(String id, String action, JSONObject params, JavaScriptReplyProxy reply) throws Exception {
        if (closed) throw new IllegalStateException("The client has closed.");
        switch (action) {
            case "socket.open" -> { sockets.open(params.getString("socketId"), params.getString("url"), reply); respond(reply, id, null, null); }
            case "socket.send" -> { sockets.send(params.getString("socketId"), params.getString("data")); respond(reply, id, null, null); }
            case "socket.close" -> { sockets.close(params.getString("socketId"), params.getInt("code"), params.getString("reason")); respond(reply, id, null, null); }
            case "external" -> { openExternal(params.getString("url")); respond(reply, id, null, null); }
            case "connections" -> { respond(reply, id, null, null); activity.finish(); }
            case "background.settings" -> {
                activity.startActivity(new Intent(activity, ConnectionSettingsActivity.class));
                respond(reply, id, null, null);
            }
            case "client" -> {
                String url = params.getString("url");
                if (!SeneraDeviceSessionPlugin.sameOrigin(url, serverUrl)) throw new SecurityException("Client must use the paired server.");
                respond(reply, id, new JSONObject().put("ok", true), null);
                openClient.accept(url);
            }
            case "download" -> {
                String url = params.getString("url");
                requireWebUrl(url);
                // Device credentials are attached only to the paired server, never to another origin.
                activity.download(url, params.getString("fileName"), SeneraDeviceSessionPlugin.sameOrigin(url, serverUrl),
                    error -> respond(reply, id, null, error));
            }
            case "save.begin" -> {
                if (pendingSave != null) throw new IllegalStateException("A save dialog is already open.");
                pendingSave = new SaveRequest(id, reply, documentGeneration);
                try { savePicker.launch(params.getString("fileName").replaceAll("[\\\\/\\p{Cntrl}]", "_")); }
                catch (RuntimeException failure) { pendingSave = null; throw failure; }
            }
            case "save.write", "save.finish", "save.abort" -> files.execute(() -> {
                try {
                    String transferId = params.getString("transferId");
                    SavedFile file = transfers.get(transferId);
                    if (file == null) throw new IOException("The file transfer is no longer available.");
                    if (action.equals("save.write")) file.stream.write(Base64.decode(params.getString("data"), Base64.DEFAULT));
                    else {
                        file.stream.close();
                        if (action.equals("save.abort")) discard(new SavedFile(file.uri, null));
                        transfers.remove(transferId);
                    }
                    respond(reply, id, null, null);
                } catch (Exception failure) {
                    SavedFile file = transfers.remove(params.optString("transferId"));
                    if (file != null) discard(file);
                    respond(reply, id, null, failure.toString());
                }
            });
            default -> throw new IllegalArgumentException("Unknown host operation: " + action);
        }
    }

    void openExternal(String url) {
        requireWebUrl(url);
        activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    void openExternalFromGesture(String url) {
        try { openExternal(url); }
        catch (ActivityNotFoundException | IllegalArgumentException failure) {
            Toast.makeText(activity, failure.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static void requireWebUrl(String value) {
        java.net.URI uri = java.net.URI.create(value);
        if (uri.getHost() == null || uri.getUserInfo() != null ||
            !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())))
            throw new IllegalArgumentException("Unsupported web address.");
    }

    private void respond(JavaScriptReplyProxy reply, String id, Object result, String error) {
        main.post(() -> {
            try {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    reply.postMessage(new JSONObject().put("id", id).put("ok", error == null)
                        .put("result", result == null ? JSONObject.NULL : result)
                        .put("error", error == null ? JSONObject.NULL : error).toString());
                } else throw new IllegalStateException("Android System WebView no longer supports the host message port.");
            } catch (Exception failure) { android.util.Log.w("SeneraMobile", "Unable to deliver host operation result", failure); }
        });
    }

    void navigationStarted() {
        documentGeneration++;
        sockets.reset();
        files.execute(() -> {
            for (SavedFile file : transfers.values()) discard(file);
            transfers.clear();
        });
    }

    void setPaused(boolean value) { sockets.setPaused(value); }

    private void discard(SavedFile file) {
        try { if (file.stream != null) file.stream.close(); }
        catch (IOException failure) { android.util.Log.w("SeneraMobile", "Unable to close interrupted file", failure); }
        try { activity.getContentResolver().delete(file.uri, null, null); }
        catch (RuntimeException failure) { android.util.Log.w("SeneraMobile", "Unable to discard interrupted file", failure); }
    }

    @Override public void close() {
        if (closed) return;
        closed = true;
        pendingSave = null;
        navigationStarted();
        sockets.close();
        files.shutdown();
    }
}
