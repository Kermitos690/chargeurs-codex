package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Staging-only helper used for controlled signer migrations on a physical DTA.
 *
 * The Activity is non-exported in AndroidManifest.xml. It never accepts or
 * persists a reusable backend secret from ADB; it only consumes the same
 * one-time six-digit pairing code as the normal ProvisioningActivity.
 */
public final class StagingMigrationEnrollmentActivity extends Activity {
    private static final String TAG = "ChargeursMigration";
    private static final String RESULT_PREFS = "chargeurs_migration_result";
    private static final String RESULT_KEY = "result";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView status = new TextView(this);
        status.setText("Migration Chargeurs.ch en cours…");
        status.setTextSize(22f);
        status.setPadding(32, 32, 32, 32);
        setContentView(status);

        getSharedPreferences(RESULT_PREFS, MODE_PRIVATE).edit().remove(RESULT_KEY).commit();

        if (!BuildConfig.DEBUG) {
            fail("NOT_DEBUG_BUILD");
            return;
        }

        Intent intent = getIntent();
        String pairingCode = clean(intent.getStringExtra("pairing_code"));
        String expectedStationId = clean(intent.getStringExtra("expected_station_id"));
        String expectedDevicePublicId = clean(intent.getStringExtra("expected_device_public_id"));

        if (!EnrollmentClient.isValidPairingCode(pairingCode)) {
            fail("INVALID_PAIRING_CODE");
            return;
        }
        if (expectedStationId.isEmpty()) {
            fail("EXPECTED_STATION_REQUIRED");
            return;
        }
        if (expectedDevicePublicId.isEmpty()) {
            fail("EXPECTED_DEVICE_PUBLIC_ID_REQUIRED");
            return;
        }

        executor.execute(() -> migrate(pairingCode, expectedStationId, expectedDevicePublicId));
    }

    private void migrate(String pairingCode, String expectedStationId, String expectedDevicePublicId) {
        try {
            SecureConfigStore store = new SecureConfigStore(this);
            KioskConfig existing = store.load();
            if (existing != null) {
                throw new IllegalStateException("CONFIG_ALREADY_PRESENT");
            }

            String devicePublicId = DeviceIdentity.getOrCreate(this);
            if (!expectedDevicePublicId.equals(devicePublicId)) {
                throw new IllegalStateException("DEVICE_PUBLIC_ID_MISMATCH");
            }

            SecureConfigStore.StorageHealth health = store.prepareForEnrollment();
            if (!health.isReady()) {
                throw new IllegalStateException("STORAGE_PREFLIGHT_" + health.code());
            }

            EnrollmentResult result = EnrollmentClient.enroll(
                BuildConfig.ENROLLMENT_URL,
                pairingCode,
                devicePublicId,
                BuildConfig.VERSION_NAME
            );
            KioskConfig config = result.config();
            if (!expectedStationId.equals(config.stationId())) {
                throw new IllegalStateException("STATION_ID_MISMATCH");
            }
            if (!KioskConfigValidator.matchesPinnedBaseUrl(
                config.baseUrl(), BuildConfig.KIOSK_PUBLIC_BASE_URL
            )) {
                throw new IllegalStateException("KIOSK_ORIGIN_MISMATCH");
            }

            SecureConfigStore.SaveResult saved = store.save(config);
            if (!saved.isSaved()) {
                throw new IllegalStateException("CONFIG_SAVE_" + saved.code());
            }
            KioskConfig persisted = store.load();
            if (persisted == null || !expectedStationId.equals(persisted.stationId())) {
                throw new IllegalStateException("CONFIG_VERIFY_FAILED");
            }

            String outcome = "PASS station=" + expectedStationId
                + " device=" + devicePublicId
                + " version=" + BuildConfig.VERSION_NAME;
            writeResult(outcome);
            Log.i(TAG, "MIGRATION_RESULT=" + outcome);

            runOnUiThread(() -> {
                Intent kiosk = new Intent(this, MainActivity.class);
                kiosk.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(kiosk);
                finish();
            });
        } catch (Exception error) {
            String code = error.getMessage() == null || error.getMessage().trim().isEmpty()
                ? error.getClass().getSimpleName()
                : error.getMessage().trim();
            fail(code);
        }
    }

    private void fail(String code) {
        String outcome = "FAIL code=" + code;
        writeResult(outcome);
        Log.e(TAG, "MIGRATION_RESULT=" + outcome);
        runOnUiThread(this::finish);
    }

    private void writeResult(String value) {
        getSharedPreferences(RESULT_PREFS, MODE_PRIVATE)
            .edit()
            .putString(RESULT_KEY, value)
            .commit();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
