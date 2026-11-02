package ai.senera.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.Toast;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/** Retains the client process; console and QQ use the same origin-scoped native socket host. */
public final class ConnectionRetentionService extends Service {
    private static final String CHANNEL = "paired-computer";
    private static final String STOP = "ai.senera.mobile.STOP_CONNECTION_RETENTION";
    private static final int NOTIFICATION = 1;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ConnectivityManager connectivity;
    private boolean observingNetwork;
    private ImageButton floatingButton;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("senera-background", MODE_PRIVATE);
    }

    static boolean enabled(Context context) { return preferences(context).getBoolean("enabled", false); }
    static boolean floatingEnabled(Context context) { return preferences(context).getBoolean("floating", false); }

    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean("enabled", enabled).apply();
        try {
            if (enabled) ensureStarted(context);
            else context.stopService(new Intent(context, ConnectionRetentionService.class));
        } catch (RuntimeException failure) {
            preferences(context).edit().putBoolean("enabled", false).apply();
            throw failure;
        }
    }

    static void setFloatingEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean("floating", enabled).apply();
        try { ensureStarted(context); }
        catch (RuntimeException failure) {
            preferences(context).edit().putBoolean("floating", false).apply();
            throw failure;
        }
    }

    /** Called only from an explicit user action or a resumed first-party activity. */
    static void ensureStarted(Context context) {
        if (enabled(context)) ContextCompat.startForegroundService(context, new Intent(context, ConnectionRetentionService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        connectivity = getSystemService(ConnectivityManager.class);
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, getString(R.string.background_channel), NotificationManager.IMPORTANCE_LOW));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            setEnabled(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!enabled(this)) { stopSelf(); return START_NOT_STICKY; }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION, notification(),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0);
            if (!observingNetwork) {
                connectivity.registerDefaultNetworkCallback(networkCallback, main);
                observingNetwork = true;
            }
        } catch (RuntimeException failure) {
            android.util.Log.e("SeneraMobile", "Unable to retain the paired-computer client", failure);
            Toast.makeText(this, getString(R.string.background_start_failed, failure.toString()), Toast.LENGTH_LONG).show();
            preferences(this).edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        refreshFloatingButton();
        // The system must not silently restart a service the user stopped.
        return START_NOT_STICKY;
    }

    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { updateNotification(); }
        @Override public void onLost(Network network) { updateNotification(); }
    };

    private PendingIntent openApplication() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notification() {
        PendingIntent settings = PendingIntent.getActivity(this, 1,
            new Intent(this, ConnectionSettingsActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2,
            new Intent(this, ConnectionRetentionService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_connection_status)
            .setContentTitle(getString(R.string.background_notification_title))
            .setContentText(getString(connectivity.getActiveNetwork() == null ? R.string.background_network_lost : R.string.background_notification_body))
            .setContentIntent(openApplication()).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, getString(R.string.background_settings_title), settings)
            .addAction(0, getString(R.string.background_stop), stop).build();
    }

    private void updateNotification() {
        if (enabled(this)) getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
    }

    private void refreshFloatingButton() {
        if (!floatingEnabled(this) || !Settings.canDrawOverlays(this)) { removeFloatingButton(); return; }
        if (floatingButton != null) return;
        WindowManager manager = getSystemService(WindowManager.class);
        int size = Math.round(52 * getResources().getDisplayMetrics().density);
        WindowManager.LayoutParams position = new WindowManager.LayoutParams(size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        position.gravity = Gravity.TOP | Gravity.START;
        position.y = size * 3;
        floatingButton = new ImageButton(this);
        floatingButton.setImageResource(R.drawable.senera_mark);
        floatingButton.setContentDescription(getString(R.string.background_return));
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(ContextCompat.getColor(this, R.color.floating_background));
        floatingButton.setBackground(background);
        floatingButton.setElevation(8 * getResources().getDisplayMetrics().density);
        floatingButton.setOnClickListener(button -> {
            try { openApplication().send(); }
            catch (PendingIntent.CanceledException failure) {
                Toast.makeText(this, failure.toString(), Toast.LENGTH_LONG).show();
            }
        });
        floatingButton.setOnTouchListener(new android.view.View.OnTouchListener() {
            private float downX, downY;
            private int startX, startY;
            private boolean dragging;
            @Override public boolean onTouch(android.view.View view, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN -> {
                        downX = event.getRawX(); downY = event.getRawY();
                        startX = position.x; startY = position.y; dragging = false;
                        return true;
                    }
                    case MotionEvent.ACTION_MOVE -> {
                        float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                        if (Math.hypot(dx, dy) > ViewConfiguration.get(view.getContext()).getScaledTouchSlop()) dragging = true;
                        if (dragging) {
                            Rect bounds = availableBounds(manager);
                            position.x = Math.max(0, Math.min(bounds.width() - size, startX + Math.round(dx)));
                            position.y = Math.max(0, Math.min(bounds.height() - size, startY + Math.round(dy)));
                            try { manager.updateViewLayout(view, position); }
                            catch (SecurityException | IllegalArgumentException failure) { floatingFailed(failure); }
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP -> { if (!dragging) view.performClick(); return true; }
                    case MotionEvent.ACTION_CANCEL -> { dragging = false; return true; }
                    default -> { return false; }
                }
            }
        });
        try { manager.addView(floatingButton, position); }
        catch (WindowManager.BadTokenException | SecurityException | IllegalArgumentException failure) { floatingFailed(failure); }
    }

    private Rect availableBounds(WindowManager manager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var metrics = manager.getCurrentWindowMetrics();
            Rect bounds = new Rect(metrics.getBounds());
            var insets = metrics.getWindowInsets().getInsetsIgnoringVisibility(
                android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            return new Rect(0, 0, bounds.width() - insets.left - insets.right,
                bounds.height() - insets.top - insets.bottom);
        }
        Point size = new Point();
        manager.getDefaultDisplay().getSize(size);
        return new Rect(0, 0, size.x, size.y);
    }

    private void floatingFailed(RuntimeException failure) {
        preferences(this).edit().putBoolean("floating", false).apply();
        android.util.Log.e("SeneraMobile", "Unable to display the floating entry", failure);
        Toast.makeText(this, getString(R.string.background_floating_failed, failure.toString()), Toast.LENGTH_LONG).show();
        removeFloatingButton();
    }

    private void removeFloatingButton() {
        if (floatingButton == null) return;
        try {
            if (floatingButton.isAttachedToWindow()) getSystemService(WindowManager.class).removeView(floatingButton);
        } catch (IllegalArgumentException failure) {
            android.util.Log.w("SeneraMobile", "Floating entry was already detached", failure);
        }
        floatingButton = null;
    }

    @Override public void onDestroy() {
        if (observingNetwork) connectivity.unregisterNetworkCallback(networkCallback);
        removeFloatingButton();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
