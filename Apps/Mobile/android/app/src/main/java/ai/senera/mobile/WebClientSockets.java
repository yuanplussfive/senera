package ai.senera.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import androidx.webkit.JavaScriptReplyProxy;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONException;
import org.json.JSONObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Owns the document's real sockets while WebView timers are suspended. All payloads stay protocol-native. */
final class WebClientSockets implements AutoCloseable {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Connection> connections = new HashMap<>();
    private final OkHttpClient client;
    private final String serverUrl;
    private final int maximumBytes;
    private final int maximumEvents;
    private final int maximumConnections;
    private boolean paused;

    private record QueuedEvent(String json, int bytes, boolean closing) {}
    private static final class Connection {
        final String id;
        final JavaScriptReplyProxy reply;
        final ArrayDeque<QueuedEvent> pending = new ArrayDeque<>();
        volatile WebSocket socket;
        int bytes;
        boolean scheduled;
        boolean terminal;
        Connection(String id, JavaScriptReplyProxy reply) { this.id = id; this.reply = reply; }
    }

    WebClientSockets(Context context, String serverUrl) {
        this.serverUrl = serverUrl;
        var resources = context.getResources();
        maximumBytes = resources.getInteger(R.integer.client_socket_buffer_bytes);
        maximumEvents = resources.getInteger(R.integer.client_socket_buffer_events);
        maximumConnections = resources.getInteger(R.integer.client_socket_limit);
        client = new OkHttpClient.Builder()
            .connectTimeout(resources.getInteger(R.integer.client_socket_connect_seconds), TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(resources.getInteger(R.integer.client_socket_ping_seconds), TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false).build();
    }

    void open(String id, String address, JavaScriptReplyProxy reply) {
        if (id.isEmpty() || id.length() > 256 || connections.containsKey(id)) throw new IllegalArgumentException("Invalid socket identity.");
        if (connections.size() >= maximumConnections) throw new IllegalStateException("Too many client connections.");
        URI source = URI.create(address);
        String scheme = source.getScheme();
        if (!("ws".equals(scheme) || "wss".equals(scheme)) || source.getRawUserInfo() != null || source.getRawFragment() != null)
            throw new SecurityException("Invalid client WebSocket address.");
        String httpAddress = ("wss".equals(scheme) ? "https" : "http") + address.substring(scheme.length());
        if (!SeneraDeviceSessionPlugin.sameOrigin(httpAddress, serverUrl)) throw new SecurityException("Socket must use the paired server.");
        URI server = URI.create(serverUrl);
        Request.Builder request = new Request.Builder().url(httpAddress).header("Origin", server.getScheme() + "://" + server.getRawAuthority());
        String cookie = CookieManager.getInstance().getCookie(httpAddress);
        if (cookie != null) request.header("Cookie", cookie);
        Connection connection = new Connection(id, reply);
        connections.put(id, connection);
        connection.socket = client.newWebSocket(request.build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket socket, Response response) { emit(connection, event("open")); }
            @Override public void onMessage(WebSocket socket, String text) { emit(connection, put(event("message"), "data", text)); }
            @Override public void onMessage(WebSocket socket, ByteString bytes) {
                socket.close(1003, "Text frames required");
                emit(connection, closed(1003, "Text frames required", false));
            }
            @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, reason); }
            @Override public void onClosed(WebSocket socket, int code, String reason) { emit(connection, closed(code, reason, true)); }
            @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                emit(connection, put(event("error"), "message", error.toString()));
                int code = response == null ? 1006 : switch (response.code()) { case 401 -> 4401; case 403 -> 4403; case 404 -> 4404; default -> 1006; };
                emit(connection, closed(code, response == null ? "network_failed" : "handshake_http_" + response.code(), false));
            }
        });
    }

    void send(String id, String data) {
        Connection connection = required(id);
        if (!connection.socket.send(data)) throw new IllegalStateException("The native connection cannot accept this message.");
    }

    void close(String id, int code, String reason) {
        Connection connection = connections.get(id);
        if (connection == null) return;
        if (code != 1000 && (code < 3000 || code > 4999)) throw new IllegalArgumentException("Invalid close code.");
        if (reason.getBytes(StandardCharsets.UTF_8).length > 123) throw new IllegalArgumentException("Close reason is too long.");
        if (!connection.socket.close(code, reason)) {
            connection.socket.cancel();
            emit(connection, closed(code, reason, false));
        }
    }

    private Connection required(String id) {
        Connection connection = connections.get(id);
        if (connection == null || connection.socket == null) throw new IllegalStateException("The native connection is unavailable.");
        return connection;
    }

    private void emit(Connection connection, JSONObject event) {
        synchronized (connection) {
            if (connection.terminal) return;
            String json = envelope(connection.id, event);
            int bytes = json.getBytes(StandardCharsets.UTF_8).length;
            boolean closing = "close".equals(event.optString("type"));
            if (connection.bytes + bytes > maximumBytes || connection.pending.size() >= maximumEvents) {
                connection.pending.clear();
                connection.bytes = 0;
                closing = true;
                json = envelope(connection.id, closed(4000, "background_buffer_exceeded", false));
                bytes = json.getBytes(StandardCharsets.UTF_8).length;
                if (connection.socket != null) connection.socket.cancel();
            }
            connection.terminal = closing;
            connection.pending.add(new QueuedEvent(json, bytes, closing));
            connection.bytes += bytes;
            schedule(connection);
        }
    }

    private void schedule(Connection connection) {
        if (connection.scheduled) return;
        connection.scheduled = true;
        main.post(() -> drain(connection));
    }

    private void drain(Connection connection) {
        synchronized (connection) {
            connection.scheduled = false;
            if (paused || connections.get(connection.id) != connection) return;
            // Yield between batches so a background catch-up cannot monopolize the UI thread.
            for (int index = 0; index < 32 && !connection.pending.isEmpty(); index++) {
                QueuedEvent event = connection.pending.remove();
                connection.bytes -= event.bytes;
                try { connection.reply.postMessage(event.json); }
                catch (RuntimeException failure) {
                    android.util.Log.w("SeneraMobile", "Unable to deliver native socket event", failure);
                    connection.socket.cancel(); connections.remove(connection.id); connection.pending.clear(); return;
                }
                if (event.closing) { connections.remove(connection.id); return; }
            }
            if (!connection.pending.isEmpty()) schedule(connection);
        }
    }

    void setPaused(boolean value) {
        paused = value;
        if (!paused) for (Connection connection : connections.values()) synchronized (connection) { schedule(connection); }
    }

    void reset() {
        for (Connection connection : connections.values()) synchronized (connection) {
            connection.terminal = true;
            connection.pending.clear();
            connection.socket.cancel();
        }
        connections.clear();
    }

    @Override public void close() {
        reset(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }

    private static JSONObject event(String type) { return put(new JSONObject(), "type", type); }
    private static JSONObject closed(int code, String reason, boolean clean) {
        return put(put(put(event("close"), "code", code), "reason", reason), "wasClean", clean);
    }
    private static String envelope(String id, JSONObject event) {
        return put(put(put(new JSONObject(), "kind", "socket.event"), "id", id), "event", event).toString();
    }
    private static JSONObject put(JSONObject object, String key, Object value) {
        try { return object.put(key, value); }
        catch (JSONException error) { throw new IllegalStateException("Invalid socket event.", error); }
    }
}
