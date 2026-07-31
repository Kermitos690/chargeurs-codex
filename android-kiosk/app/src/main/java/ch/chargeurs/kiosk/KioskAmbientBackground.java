package ch.chargeurs.kiosk;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * Lightweight native equivalent of the public site's liquid-gradient backdrop.
 * It intentionally uses canvas gradients instead of video or bitmaps so it stays
 * smooth on dedicated tablets and has no network dependency.
 */
public final class KioskAmbientBackground extends View {
    private static final int NAVY = Color.rgb(9, 11, 31);
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float phase;
    private ValueAnimator animator;

    public KioskAmbientBackground(Context context) {
        super(context);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        if (ValueAnimator.areAnimatorsEnabled()) {
            animator = ValueAnimator.ofFloat(0f, 1f);
            animator.setDuration(18_000L);
            animator.setRepeatCount(ValueAnimator.INFINITE);
            animator.setRepeatMode(ValueAnimator.REVERSE);
            animator.setInterpolator(new LinearInterpolator());
            animator.addUpdateListener(value -> {
                phase = (float) value.getAnimatedValue();
                invalidate();
            });
            animator.start();
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(NAVY);
        float w = getWidth();
        float h = getHeight();
        // A view can receive one zero-sized draw pass while the window is
        // attaching (notably on older OEM launchers). RadialGradient rejects
        // a zero radius, so leave the solid background in place until the
        // first real layout pass instead of crashing the kiosk process.
        if (w <= 0f || h <= 0f) return;
        drawGlow(canvas, w * (.18f + .05f * phase), h * (.20f - .04f * phase), Math.max(w, h) * .72f, Color.argb(92, 0, 111, 255));
        drawGlow(canvas, w * (.82f - .06f * phase), h * (.16f + .05f * phase), Math.max(w, h) * .64f, Color.argb(78, 139, 72, 255));
        drawGlow(canvas, w * (.70f + .04f * phase), h * (.82f - .04f * phase), Math.max(w, h) * .68f, Color.argb(72, 16, 207, 240));
        drawGlow(canvas, w * (.10f - .03f * phase), h * (.88f - .04f * phase), Math.max(w, h) * .62f, Color.argb(55, 139, 72, 255));
    }

    private void drawGlow(Canvas canvas, float x, float y, float radius, int color) {
        paint.setShader(new RadialGradient(x, y, radius, new int[] { color, Color.TRANSPARENT }, null, Shader.TileMode.CLAMP));
        canvas.drawCircle(x, y, radius, paint);
        paint.setShader(null);
    }

    @Override
    protected void onDetachedFromWindow() {
        if (animator != null) animator.cancel();
        super.onDetachedFromWindow();
    }
}
