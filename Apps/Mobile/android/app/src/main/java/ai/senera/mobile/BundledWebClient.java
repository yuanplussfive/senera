package ai.senera.mobile;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** All first-party WebViews serve the same APK build at the paired server origin. */
final class BundledWebClient {
    private final AssetManager assets;
    private final Set<String> files = new HashSet<>();
    private final JSONObject documents;
    private final JSONArray workspaceClients;

    BundledWebClient(AssetManager assets) throws IOException {
        this.assets = assets;
        try {
            var manifest = new JSONObject(readText("client-assets.json"));
            var declared = manifest.getJSONArray("assets");
            for (int index = 0; index < declared.length(); index++) files.add(declared.getString(index));
            documents = manifest.getJSONObject("documents");
            workspaceClients = manifest.getJSONArray("workspaceClients");
        } catch (JSONException error) { throw new IOException("Invalid packaged client manifest", error); }
    }

    WebResourceResponse intercept(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.contains("\\") || java.util.Arrays.asList(path.split("/")).contains("..")) return null;
        String document = documents.optString(path, null);
        for (int index = 0; document == null && index < workspaceClients.length(); index++) {
            var client = workspaceClients.optJSONObject(index);
            String prefix = client.optString("prefix");
            if (!path.startsWith(prefix)) continue;
            String[] suffix = path.substring(prefix.length()).split("/", -1);
            if (suffix.length != 2 || !(suffix[1].isEmpty() || suffix[1].equals("index.html"))) continue;
            try {
                if (suffix[0].length() == 36 && UUID.fromString(suffix[0]).toString().equalsIgnoreCase(suffix[0]))
                    document = client.optString("document", null);
            } catch (IllegalArgumentException invalidIdentity) { return null; }
        }
        String resource = document == null ? path : "/" + document;
        if (!files.contains(resource)) return null;
        try {
            if (document != null) {
                String html = readText(document);
                String base = resource.substring(0, resource.lastIndexOf('/') + 1);
                html = html.replace("<head>", "<head><base href=\"" + base + "\">");
                return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            }
            String extension = MimeTypeMap.getFileExtensionFromUrl(resource);
            String mime = extension.equals("js") ? "text/javascript" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", assets.open("public" + resource));
        } catch (IOException error) {
            android.util.Log.e("SeneraMobile", "Packaged client resource unavailable: " + resource, error);
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private String readText(String file) throws IOException {
        try (var reader = new BufferedReader(new InputStreamReader(assets.open("public/" + file), StandardCharsets.UTF_8))) {
            return reader.lines().collect(Collectors.joining("\n"));
        }
    }
}
