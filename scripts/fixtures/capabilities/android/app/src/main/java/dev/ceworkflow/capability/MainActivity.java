package dev.ceworkflow.capability;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 96, 48, 48);
        TextView status = new TextView(this);
        status.setText("Ready"); status.setTextSize(28);
        Button button = new Button(this);
        button.setText("Activate");
        button.setOnClickListener(view -> status.setText("Activated"));
        layout.addView(status); layout.addView(button);
        setContentView(layout);
    }
}
