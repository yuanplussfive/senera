package ai.senera.mobile;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.TextView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;
import androidx.appcompat.widget.Toolbar;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** Permission requests are explicit settings actions, separate from account pairing and camera access. */
public final class ConnectionSettingsActivity extends AppCompatActivity {
    private boolean rendering;
    private boolean awaitingOverlay;
    private SwitchCompat background;
    private SwitchCompat floating;
    private TextView error;
    private final ActivityResultLauncher<String> notifications = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) enableBackground();
            else showError(getString(R.string.background_notification_permission));
            render();
        });

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_connection_settings);
        View root = findViewById(R.id.connection_settings);
        ViewCompat.setAccessibilityHeading(findViewById(R.id.background_heading), true);
        ViewCompat.setAccessibilityHeading(findViewById(R.id.background_permissions), true);
        findViewById(R.id.permission_group).setClipToOutline(true);
        var bars = new WindowInsetsControllerCompat(getWindow(), root);
        bars.setAppearanceLightStatusBars(getResources().getBoolean(R.bool.connection_settings_light_bars));
        bars.setAppearanceLightNavigationBars(getResources().getBoolean(R.bool.connection_settings_light_bars));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        Toolbar toolbar = findViewById(R.id.connection_settings_toolbar);
        setSupportActionBar(toolbar);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        toolbar.setNavigationOnClickListener(view -> finish());
        if (toolbar.getNavigationIcon() != null)
            toolbar.getNavigationIcon().mutate().setTint(ContextCompat.getColor(this, R.color.connection_settings_text));
        background = findViewById(R.id.background_enabled);
        floating = findViewById(R.id.floating_enabled);
        error = findViewById(R.id.background_error);
        awaitingOverlay = state != null && state.getBoolean("awaitingOverlay");
        background.setOnCheckedChangeListener((button, checked) -> {
            if (rendering) return;
            error.setVisibility(View.GONE);
            if (!checked) ConnectionRetentionService.setEnabled(this, false);
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                notifications.launch(Manifest.permission.POST_NOTIFICATIONS);
            else enableBackground();
            render();
        });
        floating.setOnCheckedChangeListener((button, checked) -> {
            if (rendering) return;
            error.setVisibility(View.GONE);
            if (checked && !Settings.canDrawOverlays(this)) {
                awaitingOverlay = true;
                if (!openSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))))
                    awaitingOverlay = false;
            } else setFloating(checked);
            render();
        });
        findViewById(R.id.battery_settings).setOnClickListener(view -> openSettings(new Intent(
            getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())
                ? Settings.ACTION_APPLICATION_DETAILS_SETTINGS : Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getPackageName()))));
        findViewById(R.id.notification_settings).setOnClickListener(view -> openSettings(
            new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        findViewById(R.id.application_settings).setOnClickListener(view -> openSettings(
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
    }

    private boolean openSettings(Intent intent) {
        try { startActivity(intent); return true; }
        catch (ActivityNotFoundException | SecurityException failure) { showError(failure.toString()); return false; }
    }

    private void enableBackground() {
        try { ConnectionRetentionService.setEnabled(this, true); }
        catch (RuntimeException failure) { showError(getString(R.string.background_start_failed, failure.toString())); }
    }

    private void setFloating(boolean enabled) {
        try { ConnectionRetentionService.setFloatingEnabled(this, enabled); }
        catch (RuntimeException failure) { showError(getString(R.string.background_floating_failed, failure.toString())); }
    }

    private void showError(String reason) { error.setText(reason); error.setVisibility(View.VISIBLE); }

    private void render() {
        rendering = true;
        boolean enabled = ConnectionRetentionService.enabled(this);
        background.setChecked(enabled);
        renderStatus(R.id.background_status, enabled, R.string.background_mode_enabled, R.string.background_mode_disabled);
        floating.setEnabled(enabled);
        floating.setChecked(enabled && ConnectionRetentionService.floatingEnabled(this) && Settings.canDrawOverlays(this));
        findViewById(R.id.floating_row).setAlpha(enabled ? 1f : 0.5f);
        ((TextView) findViewById(R.id.floating_hint)).setText(enabled
            ? R.string.background_floating_hint : R.string.background_floating_requires_connection);
        PowerManager power = getSystemService(PowerManager.class);
        renderStatus(R.id.battery_status, power.isIgnoringBatteryOptimizations(getPackageName()),
            R.string.background_battery_unrestricted, R.string.background_battery_optimized);
        renderStatus(R.id.notification_status, NotificationManagerCompat.from(this).areNotificationsEnabled(),
            R.string.background_allowed, R.string.background_not_allowed);
        rendering = false;
    }

    private void renderStatus(int id, boolean allowed, int activeLabel, int inactiveLabel) {
        TextView status = findViewById(id);
        status.setText(allowed ? activeLabel : inactiveLabel);
        status.setTextColor(ContextCompat.getColor(this, allowed
            ? R.color.connection_settings_active : R.color.connection_settings_secondary));
    }

    @Override protected void onResume() {
        super.onResume();
        if (awaitingOverlay) {
            awaitingOverlay = false;
            if (Settings.canDrawOverlays(this)) setFloating(true);
            else showError(getString(R.string.background_overlay_denied));
        }
        render();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("awaitingOverlay", awaitingOverlay);
        super.onSaveInstanceState(state);
    }
}
