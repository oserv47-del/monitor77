package com.monitor;

import android.app.Activity;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.widget.MediaController;
import android.widget.RelativeLayout;
import android.widget.Toast;
import android.widget.VideoView;

public class PlayerActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Screen On karne aur Lockscreen bypass karne ka God Mode code
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN | 
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD | 
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | 
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        RelativeLayout layout = new RelativeLayout(this);
        RelativeLayout.LayoutParams params = new RelativeLayout.LayoutParams(
			RelativeLayout.LayoutParams.MATCH_PARENT,
			RelativeLayout.LayoutParams.MATCH_PARENT);
        layout.setLayoutParams(params);
        layout.setBackgroundColor(0xFF000000); 

        final VideoView videoView = new VideoView(this);
        RelativeLayout.LayoutParams videoParams = new RelativeLayout.LayoutParams(
			RelativeLayout.LayoutParams.MATCH_PARENT,
			RelativeLayout.LayoutParams.MATCH_PARENT);
        videoParams.addRule(RelativeLayout.CENTER_IN_PARENT, RelativeLayout.TRUE);
        videoView.setLayoutParams(videoParams);

        layout.addView(videoView);
        setContentView(layout);

        String videoUrl = getIntent().getStringExtra("video_url");

        if (videoUrl != null && !videoUrl.isEmpty()) {
            try {
                Uri uri = Uri.parse(videoUrl);
                videoView.setVideoURI(uri);

                MediaController mediaController = new MediaController(this);
                mediaController.setAnchorView(videoView);
                videoView.setMediaController(mediaController);

                videoView.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
						@Override
						public void onPrepared(MediaPlayer mp) {
							videoView.start();
						}
					});

            } catch (Exception e) {
                Toast.makeText(this, "Error playing video", Toast.LENGTH_SHORT).show();
            }
        } else {
            finish(); 
        }
    }
}

