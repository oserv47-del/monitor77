package com.monitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class KeepAliveReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // Service ko dobara start karein
        Intent serviceIntent = new Intent(context, TelegramService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                context.startForegroundService(serviceIntent);
            } catch (Exception e) {}
        } else {
            context.startService(serviceIntent);
        }
    }
}

