package ch.chargeurs.kiosk;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

/** Shared native design tokens aligned with src/index.css. */
public final class KioskVisuals {
    public static final int WHITE = Color.rgb(250, 252, 255);
    public static final int MUTED = Color.rgb(178, 192, 222);
    public static final int PANEL = Color.argb(196, 26, 38, 73);
    public static final int PANEL_BORDER = Color.argb(68, 207, 228, 255);
    private static final int BLUE = Color.rgb(51, 139, 255);
    private static final int VIOLET = Color.rgb(151, 83, 246);
    private static final int CYAN = Color.rgb(31, 211, 249);

    private KioskVisuals() {}

    public static void applyKioskWindow(Activity activity) {
        activity.getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SECURE
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        // Use the legacy immersive flags on every supported API level. This
        // avoids loading WindowInsetsController classes on older industrial
        // tablets while providing the same fullscreen behaviour there.
        activity.getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    public static GradientDrawable glassPanel(float radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(PANEL);
        drawable.setCornerRadius(radiusPx);
        drawable.setStroke(1, PANEL_BORDER);
        return drawable;
    }

    public static GradientDrawable primaryButton(float radiusPx) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] { BLUE, VIOLET });
        drawable.setCornerRadius(radiusPx);
        return drawable;
    }

    public static GradientDrawable secondaryButton(float radiusPx) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] { Color.argb(190, 22, 39, 77), Color.argb(190, 61, 43, 116) });
        drawable.setCornerRadius(radiusPx);
        drawable.setStroke(1, PANEL_BORDER);
        return drawable;
    }

    public static GradientDrawable codeCell(boolean filled, float radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(filled ? Color.argb(185, 24, 68, 132) : Color.argb(144, 16, 29, 59));
        drawable.setCornerRadius(radiusPx);
        drawable.setStroke(2, filled ? CYAN : PANEL_BORDER);
        return drawable;
    }

    public static void fadeIn(View view) {
        view.setAlpha(0f);
        view.setTranslationY(20f);
        view.animate().alpha(1f).translationY(0f).setDuration(420L).start();
    }

    public static TextView brandText(Activity activity, int sizeSp) {
        TextView brand = new TextView(activity);
        brand.setText(activity.getString(R.string.brand_name));
        brand.setTextColor(WHITE);
        brand.setTextSize(sizeSp);
        brand.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return brand;
    }
}
