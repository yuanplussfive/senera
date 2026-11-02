package ai.senera.mobile;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** First-party console and channel documents share one origin-scoped host capability port. */
public class ChannelClientActivity extends AppCompatActivity {
    private static final java.util.Set<ChannelClientActivity> clients =
        java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());

    /** The picker can be the task's top Activity while its owning client is still alive. UI thread only. */
    static boolean hasOpenClient(int taskId, String server) {
        return clients.stream().anyMatch(client -> !client.isFinishing() && !client.isDestroyed() &&
            client.getTaskId() == taskId && SeneraDeviceSessionPlugin.sameOrigin(client.serverUrl, server));
    }
    private WebView view;
    private WebClientHost host;
    private BundledWebClient bundled;
    private String consolePath;
    private String serverUrl;
    private String resumeClientUrl;
    private ValueCallback<Uri[]> fileSelection;
    private boolean contentPaused;
    private final java.util.Set<WebView> pendingWindows = new java.util.HashSet<>();
    private String pendingDownloadUrl;
    private String pendingDownloadName;
    private boolean pendingDownloadCredentials;
    private java.util.function.Consumer<String> downloadResult;
    private final ActivityResultLauncher<String> downloadPermission = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
        if (granted && pendingDownloadUrl != null) {
            startDownload(pendingDownloadUrl, pendingDownloadName, pendingDownloadCredentials);
        } else {
            Toast.makeText(this, R.string.download_permission_required, Toast.LENGTH_LONG).show();
            finishDownload(getString(R.string.download_permission_required));
        }
        pendingDownloadUrl = null;
        pendingDownloadName = null;
    });
    private final ActivityResultLauncher<Intent> picker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
        ValueCallback<Uri[]> selection = fileSelection;
        fileSelection = null;
        if (selection != null) selection.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()));
    });

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra("url");
        if (!SeneraDeviceSessionPlugin.isDeviceUrl(url)) { finish(); return; }
        serverUrl = url;
        clients.add(this);
        host = new WebClientHost(this, url, this::openChannel);
        String initialUrl = url;
        if (state == null && getIntent().getBooleanExtra("restorePosition", false)) {
            ClientNavigationState.Location previous = ClientNavigationState.read(this, url);
            if (previous != null) {
                if (previous.bundledConsole) initialUrl = previous.url;
                else resumeClientUrl = previous.url;
            }
        }
        FrameLayout container = new FrameLayout(this);
        view = new WebView(this);
        try { bundled = new BundledWebClient(getAssets()); host.install(view); }
        catch (java.io.IOException failure) {
            Toast.makeText(this, failure.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setUseWideViewPort(true);
        view.getSettings().setSupportMultipleWindows(true);
        view.getSettings().setAllowFileAccess(false);
        // The system picker returns content:// URIs with a grant for the selected files.
        // WebView needs provider access to read those files for multipart uploads.
        view.getSettings().setAllowContentAccess(true);
        view.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView webView, String startedUrl, android.graphics.Bitmap favicon) {
                host.navigationStarted();
            }
            @Override public void onPageFinished(WebView webView, String finishedUrl) {
                rememberPosition();
                if (resumeClientUrl != null) {
                    String target = resumeClientUrl;
                    resumeClientUrl = null;
                    openChannel(target);
                }
                consolePath = null;
                if (getIntent().getBooleanExtra("bundledConsole", false) ||
                    !SeneraDeviceSessionPlugin.sameOrigin(finishedUrl, url)) return;
                // The host declares its real console route for dev and packaged deployments.
                // Navigation metadata uses the same paired origin as the host capability port.
                webView.evaluateJavascript("document.querySelector('meta[name=\"senera-console-path\"]')?.content ?? null", value -> {
                    if (!finishedUrl.equals(webView.getUrl())) return;
                    try {
                        Object path = new org.json.JSONTokener(value).nextValue();
                        if (path instanceof String && ((String) path).startsWith("/")) consolePath = (String) path;
                    } catch (org.json.JSONException failure) {
                        android.util.Log.w("SeneraMobile", "Invalid console navigation metadata", failure);
                    }
                });
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                if ("http".equals(request.getUrl().getScheme()) && !SeneraDeviceSessionPlugin.sameOrigin(request.getUrl().toString(), url))
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
                if (SeneraDeviceSessionPlugin.sameOrigin(request.getUrl().toString(), url)) {
                    String path = request.getUrl().getPath();
                    if ("/senera-runtime-config.js".equals(path)) {
                        String origin = java.net.URI.create(url).getScheme() + "://" + java.net.URI.create(url).getRawAuthority();
                        String runtime = "window.__SENERA_RUNTIME_CONFIG__={httpBaseUrl:" + org.json.JSONObject.quote(origin) +
                            ",webSocketUrl:" + org.json.JSONObject.quote(origin.replaceFirst("^http", "ws")) + "};";
                        return new WebResourceResponse("text/javascript", "UTF-8", new java.io.ByteArrayInputStream(runtime.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                    }
                    return bundled.intercept(request.getUrl());
                }
                return null;
            }
            @Override public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                showConnectionError(container, error.getErrorCode());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                if (request.isForMainFrame() && !getIntent().getBooleanExtra("bundledConsole", false) &&
                    ("/".equals(request.getUrl().getPath()) || (consolePath != null && consolePath.equals(request.getUrl().getPath()))) &&
                    SeneraDeviceSessionPlugin.sameOrigin(webView.getUrl(), url) &&
                    SeneraDeviceSessionPlugin.sameOrigin(request.getUrl().toString(), url)) {
                    finish();
                    return true;
                }
                if (SeneraDeviceSessionPlugin.sameOrigin(request.getUrl().toString(), url)) return false;
                if (!request.isForMainFrame()) return true;
                String scheme = request.getUrl().getScheme();
                if (!"https".equals(scheme) && !"http".equals(scheme)) return true;
                host.openExternalFromGesture(request.getUrl().toString());
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView parent, boolean dialog, boolean userGesture, Message message) {
                if (!userGesture) return false;
                // Receive only the requested URL. The temporary view never
                // executes the destination document or receives a native bridge.
                WebView pending = new WebView(ChannelClientActivity.this);
                pendingWindows.add(pending);
                pending.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        String target = request.getUrl().toString();
                        if (SeneraDeviceSessionPlugin.sameOrigin(target, url)) {
                            openChannel(target);
                        } else host.openExternalFromGesture(target);
                        pendingWindows.remove(child);
                        child.post(child::destroy);
                        return true;
                    }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(pending);
                message.sendToTarget();
                return true;
            }
            @Override public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileSelection != null) fileSelection.onReceiveValue(null);
                fileSelection = callback;
                try { picker.launch(parameters.createIntent()); return true; }
                catch (RuntimeException failure) {
                    fileSelection = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(ChannelClientActivity.this, failure.getMessage(), Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });
        view.setDownloadListener((source, userAgent, disposition, mime, length) -> {
            String name = android.webkit.URLUtil.guessFileName(source, disposition, mime);
            download(source, name, SeneraDeviceSessionPlugin.sameOrigin(source, url), error -> {
                if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show();
            });
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                view.evaluateJavascript("(()=>{const modal=document.querySelector('[role=dialog][data-state=open]');if(!modal)return false;modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()", handled -> {
                    if ("true".equals(handled)) return;
                    if (view.canGoBack()) view.goBack(); else finish();
                });
            }
        });
        container.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(container);
        ViewCompat.setOnApplyWindowInsetsListener(container, (content, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            content.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        Bundle browserState = state == null ? null : state.getBundle("browserState");
        boolean restored = browserState != null && view.restoreState(browserState) != null;
        if (!restored || !SeneraDeviceSessionPlugin.sameOrigin(view.getUrl(), url)) view.loadUrl(initialUrl);
        if (state != null && state.getBoolean("fileSelectionPending", false))
            Toast.makeText(this, "应用已恢复，请重新选择尚未读取的文件。", Toast.LENGTH_LONG).show();
    }

    private void openChannel(String target) {
        Intent client = new Intent(this, ChannelClientActivity.class);
        client.putExtra("url", target);
        client.putExtra("rememberPosition", true);
        startActivity(client);
    }

    private void rememberPosition() {
        if (view != null && getIntent().getBooleanExtra("rememberPosition", false))
            ClientNavigationState.save(this, serverUrl, view.getUrl(), getIntent().getBooleanExtra("bundledConsole", false));
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (view != null) {
            Bundle browserState = new Bundle();
            view.saveState(browserState);
            state.putBundle("browserState", browserState);
            state.putBoolean("fileSelectionPending", fileSelection != null);
            rememberPosition();
        }
        super.onSaveInstanceState(state);
    }

    private void showConnectionError(FrameLayout container, int code) {
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density); panel.setPadding(padding, padding, padding, padding);
        panel.setBackgroundColor(android.graphics.Color.WHITE);
        TextView reason = new TextView(this);
        reason.setText(code == WebViewClient.ERROR_HOST_LOOKUP ? R.string.connection_dns : code == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE ?
            R.string.connection_tls : code == WebViewClient.ERROR_TIMEOUT ? R.string.connection_timeout : R.string.connection_failed);
        panel.addView(reason);
        Button retry = new Button(this); retry.setText(R.string.connection_retry);
        retry.setOnClickListener(button -> { container.removeView(panel); view.reload(); }); panel.addView(retry);
        Button back = new Button(this); back.setText(R.string.connection_back); back.setOnClickListener(button -> finish()); panel.addView(back);
        container.addView(panel, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void startDownload(String url, String name, boolean credentials) {
        try {
            SeneraDeviceSessionPlugin.enqueueDownload(this, url, name, credentials);
            finishDownload(null);
        } catch (RuntimeException failure) {
            finishDownload(failure.getMessage() == null ? getString(R.string.download_failed) : failure.getMessage());
        }
    }

    private void finishDownload(String error) {
        var result = downloadResult;
        downloadResult = null;
        if (result != null) result.accept(error);
    }

    void download(String source, String name, boolean credentials, java.util.function.Consumer<String> result) {
        if (downloadResult != null) { result.accept("Another download permission request is pending."); return; }
        downloadResult = result;
        if (SeneraDeviceSessionPlugin.needsDownloadPermission(this)) {
            pendingDownloadUrl = source;
            pendingDownloadName = name;
            pendingDownloadCredentials = credentials;
            downloadPermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        } else {
            startDownload(source, name, credentials);
        }
    }

    @Override protected void onPause() {
        // The system picker is part of this document's interaction, not a new client session.
        // Do not run the app's background recovery cycle just to return a selected content URI.
        if (fileSelection == null) pauseContent();
        super.onPause();
    }

    private void pauseContent() {
        if (contentPaused) return;
        contentPaused = true;
        if (host != null) host.setPaused(true);
        if (view != null) {
            rememberPosition();
            view.evaluateJavascript("window.dispatchEvent(new Event('senera:pause'))", null);
            view.onPause();
        }
    }
    @Override protected void onResume() {
        super.onResume();
        if (contentPaused) {
            contentPaused = false;
            if (host != null) host.setPaused(false);
            if (view != null) {
                view.onResume();
                view.evaluateJavascript("window.dispatchEvent(new Event('senera:resume'))", null);
            }
        }
        try { ConnectionRetentionService.ensureStarted(this); }
        catch (RuntimeException failure) {
            Toast.makeText(this, getString(R.string.background_start_failed, failure.toString()), Toast.LENGTH_LONG).show();
        }
        rememberPosition();
    }
    @Override protected void onDestroy() {
        clients.remove(this);
        if (fileSelection != null) fileSelection.onReceiveValue(null);
        for (WebView pending : pendingWindows) pending.destroy();
        pendingWindows.clear();
        if (host != null) host.close();
        if (view != null) view.destroy();
        super.onDestroy();
    }
}
