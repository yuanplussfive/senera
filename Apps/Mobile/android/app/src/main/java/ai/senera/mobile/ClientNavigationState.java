package ai.senera.mobile;

import android.content.Context;

/** Last document per paired origin. Web content keeps workspace and conversation selection. */
final class ClientNavigationState {
    private static final String PREFERENCES = "senera.client.navigation";

    static final class Location {
        final String url;
        final boolean bundledConsole;
        Location(String url, boolean bundledConsole) { this.url = url; this.bundledConsole = bundledConsole; }
    }

    static Location read(Context context, String serverUrl) {
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String key = origin(serverUrl);
        String target = preferences.getString(key, null);
        return SeneraDeviceSessionPlugin.sameOrigin(target, serverUrl) ? new Location(target, preferences.getBoolean(key + ".console", true)) : null;
    }

    static void save(Context context, String serverUrl, String target, boolean bundledConsole) {
        if (SeneraDeviceSessionPlugin.sameOrigin(target, serverUrl))
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
                .putString(origin(serverUrl), target).putBoolean(origin(serverUrl) + ".console", bundledConsole).apply();
    }

    private static String origin(String url) {
        java.net.URI uri = java.net.URI.create(url);
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }
}
