package ch.chargeurs.kiosk;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class TabletExtractionActivity extends Activity {
    private static final String STATION_ID = "DTA21269";
    private static final int PICK_CONFIG_TREE = 21269;
    private static final long MAX_SELECTED_FILE_BYTES = 10L * 1024L * 1024L;
    private static final Pattern SENSITIVE_VALUE = Pattern.compile(
        "(?i)(\\\"?(?:token|secret|password|passwd|passphrase|api[_-]?key|private[_-]?key|credential|cookie|session|authorization|bearer)\\\"?\\s*[:=]\\s*)(\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;]+)"
    );

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView status;
    private TextView details;
    private ProgressBar progressBar;
    private Button extractButton;
    private Button shareButton;
    private Button configButton;
    private Uri selectedConfigTree;
    private Uri lastArchiveUri;
    private String lastArchiveName = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
    }

    private ScrollView buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 38));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(28), dp(34), dp(28), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Extraction tablette Chargeurs.ch", 29, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap(0, dp(10)));

        TextView help = text(
            "Crée un seul ZIP avec le diagnostic matériel, l’inventaire Android et, si tu le sélectionnes, le dossier bajie_config filtré.",
            15,
            Color.rgb(190, 202, 226)
        );
        help.setGravity(Gravity.CENTER);
        content.addView(help, matchWrap(0, dp(16)));

        progressBar = new ProgressBar(this);
        progressBar.setVisibility(ProgressBar.GONE);
        content.addView(progressBar, new LinearLayout.LayoutParams(dp(52), dp(52)));

        status = text("Prêt à extraire.", 16, Color.rgb(119, 255, 184));
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(14), dp(14), dp(14), dp(14));
        status.setBackgroundColor(Color.rgb(19, 34, 66));
        content.addView(status, matchWrap(dp(10), dp(16)));

        configButton = actionButton("Sélectionner bajie_config — optionnel", this::pickConfigTree);
        content.addView(configButton, fullButton());

        extractButton = actionButton("Créer l’archive complète", this::startExtraction);
        LinearLayout.LayoutParams extractParams = fullButton();
        extractParams.setMargins(0, dp(10), 0, 0);
        content.addView(extractButton, extractParams);

        shareButton = actionButton("Partager la dernière archive", this::shareLastArchive);
        shareButton.setEnabled(false);
        LinearLayout.LayoutParams shareParams = fullButton();
        shareParams.setMargins(0, dp(10), 0, 0);
        content.addView(shareButton, shareParams);

        details = text(
            "Aucun réglage n’est modifié. Aucune commande n’est envoyée au PCB. Les valeurs sensibles détectées dans le dossier choisi sont masquées.",
            13,
            Color.rgb(190, 202, 226)
        );
        details.setTextIsSelectable(true);
        details.setPadding(dp(14), dp(14), dp(14), dp(14));
        details.setBackgroundColor(Color.rgb(19, 34, 66));
        content.addView(details, matchWrap(dp(16), 0));
        return scroll;
    }

    private void pickConfigTree() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_CONFIG_TREE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_CONFIG_TREE || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        selectedConfigTree = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(selectedConfigTree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
        }
        configButton.setText("bajie_config sélectionné ✓");
    }

    private void startExtraction() {
        setBusy(true, "Création de l’archive…");
        executor.execute(() -> {
            try {
                String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
                File workspace = new File(getCacheDir(), "tablet-extraction-" + stamp);
                deleteRecursively(workspace);
                ensureDirectory(workspace);

                JSONObject manifest = buildManifest();
                writeText(new File(workspace, "MANIFEST.json"), manifest.toString(2));

                JSONObject hardware = HardwareDiagnosticCollector.collect(this);
                writeText(new File(workspace, "diagnostic-materiel.json"), hardware.toString(2));

                JSONArray packages = collectPackages();
                writeText(new File(workspace, "applications-installees.json"), packages.toString(2));

                JSONObject configReport = copySelectedConfig(workspace);
                writeText(new File(workspace, "bajie-config-report.json"), configReport.toString(2));

                writeChecksums(workspace);

                String filename = "DTA21269-extraction-tablette-v1.0.8-" + stamp + ".zip";
                File zip = new File(getCacheDir(), filename);
                zipDirectory(workspace, zip);
                Uri uri = saveZipToDownloads(filename, zip);

                lastArchiveUri = uri;
                lastArchiveName = filename;
                runOnUiThread(() -> {
                    setBusy(false, "Archive terminée ✓");
                    shareButton.setEnabled(true);
                    details.setText(
                        "Fichier : " + filename
                            + "\nTaille : " + humanBytes(zip.length())
                            + "\nApplications inventoriées : " + packages.length()
                            + "\nbajie_config : " + (configReport.optBoolean("included", false) ? "inclus" : "non inclus")
                    );
                    shareArchive(uri, filename);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Échec de l’extraction");
                    details.setText(error.getClass().getSimpleName() + " — " + error.getMessage());
                    Toast.makeText(this, "L’extraction a échoué.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private JSONObject buildManifest() throws Exception {
        JSONObject value = new JSONObject();
        value.put("stationId", STATION_ID);
        value.put("extractorVersion", BuildConfig.VERSION_NAME);
        value.put("generatedAt", System.currentTimeMillis());
        value.put("manufacturer", Build.MANUFACTURER);
        value.put("model", Build.MODEL);
        value.put("product", Build.PRODUCT);
        value.put("hardware", Build.HARDWARE);
        value.put("androidRelease", Build.VERSION.RELEASE);
        value.put("sdk", Build.VERSION.SDK_INT);
        value.put("fingerprint", Build.FINGERPRINT);
        value.put("safeReadOnly", true);
        value.put("serialBytesWritten", 0);
        value.put("pcbCommandSent", false);
        value.put("settingsChanged", false);
        return value;
    }

    @SuppressWarnings("deprecation")
    private JSONArray collectPackages() throws Exception {
        PackageManager pm = getPackageManager();
        List<PackageInfo> installed = pm.getInstalledPackages(0);
        installed.sort(Comparator.comparing(value -> value.packageName));
        JSONArray report = new JSONArray();
        for (PackageInfo info : installed) {
            if (info == null || info.packageName == null) continue;
            JSONObject item = new JSONObject();
            item.put("package", info.packageName);
            item.put("versionName", info.versionName == null ? "" : info.versionName);
            item.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            ApplicationInfo app = info.applicationInfo;
            item.put("enabled", app != null && app.enabled);
            item.put("systemApp", app != null && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            item.put("sourceDir", app == null ? "" : app.sourceDir);
            report.put(item);
        }
        return report;
    }

    private JSONObject copySelectedConfig(File workspace) throws Exception {
        JSONObject report = new JSONObject();
        report.put("included", false);
        if (selectedConfigTree == null) return report;
        File destination = new File(workspace, "bajie_config_redacted");
        ensureDirectory(destination);
        int count = copyChildren(selectedConfigTree, DocumentsContract.getTreeDocumentId(selectedConfigTree), destination, 0);
        report.put("included", true);
        report.put("filesCopied", count);
        return report;
    }

    private int copyChildren(Uri treeUri, String parentId, File destination, int depth) throws Exception {
        if (depth > 10) return 0;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] projection = new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
        };
        int copied = 0;
        try (Cursor cursor = getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return 0;
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String name = safeName(cursor.getString(1) == null ? "unnamed" : cursor.getString(1));
                String mime = cursor.getString(2);
                long size = cursor.isNull(3) ? -1L : cursor.getLong(3);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    File child = new File(destination, name);
                    ensureDirectory(child);
                    copied += copyChildren(treeUri, id, child, depth + 1);
                } else if (size <= MAX_SELECTED_FILE_BYTES && !isBlocked(name)) {
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    try (InputStream input = getContentResolver().openInputStream(documentUri)) {
                        if (input == null) continue;
                        byte[] bytes = readLimited(input, MAX_SELECTED_FILE_BYTES);
                        if (isText(name, mime)) {
                            String text = new String(bytes, StandardCharsets.UTF_8);
                            text = SENSITIVE_VALUE.matcher(text).replaceAll("$1\"[REDACTED]\"");
                            bytes = text.getBytes(StandardCharsets.UTF_8);
                        }
                        writeBytes(new File(destination, name), bytes);
                        copied++;
                    }
                }
            }
        }
        return copied;
    }

    private void writeChecksums(File workspace) throws Exception {
        List<File> files = listFiles(workspace);
        files.sort(Comparator.comparing(file -> relative(workspace, file)));
        StringBuilder text = new StringBuilder();
        for (File file : files) {
            if (file.isFile()) text.append(sha256(file)).append("  ").append(relative(workspace, file)).append('\n');
        }
        writeText(new File(workspace, "SHA256SUMS.txt"), text.toString());
    }

    private void zipDirectory(File source, File destination) throws Exception {
        try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(destination)))) {
            byte[] buffer = new byte[64 * 1024];
            for (File file : listFiles(source)) {
                if (!file.isFile()) continue;
                zip.putNextEntry(new ZipEntry("DTA21269-tablet-extraction/" + relative(source, file)));
                try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
                    int count;
                    while ((count = input.read(buffer)) != -1) zip.write(buffer, 0, count);
                }
                zip.closeEntry();
            }
        }
    }

    private Uri saveZipToDownloads(String filename, File zip) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Chargeurs");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("DOWNLOAD_INSERT_FAILED");
        try (InputStream input = new BufferedInputStream(new FileInputStream(zip));
             OutputStream output = new BufferedOutputStream(getContentResolver().openOutputStream(uri))) {
            if (output == null) throw new IllegalStateException("DOWNLOAD_OPEN_FAILED");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        ContentValues ready = new ContentValues();
        ready.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(uri, ready, null, null);
        return uri;
    }

    private void shareLastArchive() {
        if (lastArchiveUri != null) shareArchive(lastArchiveUri, lastArchiveName);
    }

    private void shareArchive(Uri uri, String filename) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("application/zip");
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.putExtra(Intent.EXTRA_SUBJECT, "Extraction tablette " + STATION_ID);
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(share, "Envoyer " + filename));
    }

    private byte[] readLimited(InputStream input, long limit) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            long total = 0L;
            int count;
            while ((count = source.read(buffer)) != -1) {
                if (total + count > limit) break;
                output.write(buffer, 0, count);
                total += count;
            }
            return output.toByteArray();
        }
    }

    private List<File> listFiles(File root) {
        List<File> result = new ArrayList<>();
        File[] children = root.listFiles();
        if (children == null) return result;
        for (File child : children) {
            if (child.isDirectory()) result.addAll(listFiles(child));
            else result.add(child);
        }
        return result;
    }

    private void writeText(File file, String value) throws Exception {
        writeBytes(file, value.getBytes(StandardCharsets.UTF_8));
    }

    private void writeBytes(File file, byte[] value) throws Exception {
        ensureDirectory(file.getParentFile());
        try (OutputStream output = new BufferedOutputStream(new FileOutputStream(file))) {
            output.write(value);
        }
    }

    private void ensureDirectory(File directory) throws Exception {
        if (directory != null && !directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("DIRECTORY_CREATE_FAILED");
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.US, "%02x", item));
        return value.toString();
    }

    private String relative(File root, File file) {
        return root.toURI().relativize(file.toURI()).getPath();
    }

    private String safeName(String value) {
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private boolean isBlocked(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".db") || lower.endsWith(".sqlite") || lower.endsWith(".pem")
            || lower.endsWith(".key") || lower.endsWith(".jks") || lower.endsWith(".p12")
            || lower.contains("keystore") || lower.contains("password") || lower.contains("credential");
    }

    private boolean isText(String name, String mime) {
        String lower = name.toLowerCase(Locale.ROOT);
        return (mime != null && mime.startsWith("text/")) || lower.endsWith(".json")
            || lower.endsWith(".xml") || lower.endsWith(".txt") || lower.endsWith(".properties")
            || lower.endsWith(".conf") || lower.endsWith(".cfg") || lower.endsWith(".ini")
            || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".log");
    }

    private String humanBytes(long bytes) {
        if (bytes < 1024L) return bytes + " o";
        double value = bytes;
        String[] units = new String[]{"Ko", "Mo", "Go"};
        int unit = -1;
        while (value >= 1024.0 && unit < units.length - 1) {
            value /= 1024.0;
            unit++;
        }
        return String.format(Locale.FRANCE, "%.1f %s", value, units[unit]);
    }

    private void setBusy(boolean busy, String message) {
        extractButton.setEnabled(!busy);
        configButton.setEnabled(!busy);
        shareButton.setEnabled(!busy && lastArchiveUri != null);
        progressBar.setVisibility(busy ? ProgressBar.VISIBLE : ProgressBar.GONE);
        status.setText(message);
    }

    private Button actionButton(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(16);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private LinearLayout.LayoutParams fullButton() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap(int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, top, 0, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
