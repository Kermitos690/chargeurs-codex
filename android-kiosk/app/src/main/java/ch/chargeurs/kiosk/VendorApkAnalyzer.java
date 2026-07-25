package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Passive interoperability inventory for an installed vendor APK.
 *
 * The analyzer never copies or modifies the APK, never opens a serial device,
 * and never executes vendor code. It hashes the installed package, inventories
 * archive entries and extracts a bounded set of printable strings that contain
 * serial/hardware interoperability keywords. Samples are aggressively redacted.
 */
public final class VendorApkAnalyzer {
    private static final int MAX_ENTRIES = 8_000;
    private static final int MAX_ENTRY_BYTES = 8 * 1024 * 1024;
    private static final int MAX_TOTAL_SCANNED_BYTES = 48 * 1024 * 1024;
    private static final int MAX_HITS = 300;
    private static final int MAX_SAMPLE_LENGTH = 220;

    private static final List<String> KEYWORDS = Arrays.asList(
        "/dev/ttys1", "ttys1", "cloudpos_serial", "cloudpos", "serialport",
        "serial", "uart", "rs485", "baudrate", "baud", "stty", "crc16",
        "crc", "checksum", "cabinet", "slotnum", "slot", "eject", "battery",
        "powerbank", "power bank", "dta", "9600"
    );

    private VendorApkAnalyzer() {}

    public static JSONObject analyze(Context context, String packageName) {
        JSONObject result = new JSONObject();
        put(result, "schemaVersion", 1);
        put(result, "package", packageName);
        put(result, "generatedAt", System.currentTimeMillis());
        put(result, "safeReadOnly", true);
        put(result, "vendorApkCopied", false);
        put(result, "vendorCodeExecuted", false);
        put(result, "serialPortOpened", false);
        put(result, "serialBytesWritten", 0);
        put(result, "credentialsCollected", false);

        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(packageName, 0);
            File apk = new File(info.sourceDir);
            put(result, "sourceReadable", apk.isFile() && apk.canRead());
            put(result, "apkSizeBytes", apk.length());
            put(result, "apkSha256", sha256(apk));
            put(result, "sourcePathBasename", apk.getName());

            JSONObject archive = inspectArchive(apk);
            put(result, "archive", archive);
            put(result, "status", "COMPLETED");
        } catch (PackageManager.NameNotFoundException error) {
            put(result, "status", "VENDOR_PACKAGE_NOT_FOUND");
            put(result, "error", error.getClass().getSimpleName());
        } catch (Exception error) {
            put(result, "status", "ANALYSIS_FAILED");
            put(result, "error", error.getClass().getSimpleName());
        }
        return result;
    }

    private static JSONObject inspectArchive(File apk) throws Exception {
        JSONObject archive = new JSONObject();
        JSONArray dexFiles = new JSONArray();
        JSONArray nativeLibraries = new JSONArray();
        JSONArray notableEntries = new JSONArray();
        JSONArray keywordHits = new JSONArray();
        Set<String> uniqueHits = new TreeSet<>();

        int entryCount = 0;
        int scannedEntryCount = 0;
        long scannedBytes = 0;
        boolean truncated = false;

        try (ZipFile zip = new ZipFile(apk)) {
            List<ZipEntry> entries = new ArrayList<>();
            Enumeration<? extends ZipEntry> enumeration = zip.entries();
            while (enumeration.hasMoreElements() && entries.size() < MAX_ENTRIES) {
                entries.add(enumeration.nextElement());
            }
            entries.sort(Comparator.comparing(ZipEntry::getName));
            entryCount = entries.size();

            for (ZipEntry entry : entries) {
                if (entry.isDirectory()) continue;
                String name = entry.getName();
                String lower = name.toLowerCase(Locale.US);

                if (lower.matches("classes[0-9]*\\.dex")) {
                    dexFiles.put(entryMetadata(zip, entry));
                } else if (lower.startsWith("lib/") && lower.endsWith(".so")) {
                    nativeLibraries.put(entryMetadata(zip, entry));
                } else if (isNotableEntry(lower) && notableEntries.length() < 250) {
                    notableEntries.put(name);
                }

                if (!shouldScan(lower)) continue;
                if (keywordHits.length() >= MAX_HITS || scannedBytes >= MAX_TOTAL_SCANNED_BYTES) {
                    truncated = true;
                    break;
                }

                byte[] bytes = readBounded(zip.getInputStream(entry), MAX_ENTRY_BYTES);
                scannedEntryCount += 1;
                scannedBytes += bytes.length;
                extractKeywordHits(name, bytes, keywordHits, uniqueHits);
            }
        }

        put(archive, "entryCount", entryCount);
        put(archive, "scannedEntryCount", scannedEntryCount);
        put(archive, "scannedBytes", scannedBytes);
        put(archive, "scanTruncated", truncated);
        put(archive, "dexFiles", dexFiles);
        put(archive, "nativeLibraries", nativeLibraries);
        put(archive, "notableEntries", notableEntries);
        put(archive, "keywordHits", keywordHits);
        put(archive, "keywordHitCount", keywordHits.length());
        put(archive, "keywords", new JSONArray(KEYWORDS));
        return archive;
    }

    private static JSONObject entryMetadata(ZipFile zip, ZipEntry entry) throws Exception {
        JSONObject item = new JSONObject();
        put(item, "name", entry.getName());
        put(item, "size", entry.getSize());
        put(item, "compressedSize", entry.getCompressedSize());
        try (InputStream input = zip.getInputStream(entry)) {
            put(item, "sha256", sha256(input));
        }
        return item;
    }

    private static boolean isNotableEntry(String lower) {
        return lower.contains("serial") || lower.contains("cloudpos") || lower.contains("uart")
            || lower.contains("rs485") || lower.contains("cabinet") || lower.contains("battery")
            || lower.contains("powerbank") || lower.contains("dta") || lower.contains("slot")
            || lower.contains("eject") || lower.contains("crc");
    }

    private static boolean shouldScan(String lower) {
        return lower.matches("classes[0-9]*\\.dex")
            || (lower.startsWith("lib/") && lower.endsWith(".so"))
            || lower.startsWith("assets/")
            || lower.startsWith("res/raw/")
            || lower.endsWith(".json")
            || lower.endsWith(".xml")
            || lower.endsWith(".properties")
            || lower.endsWith(".conf")
            || lower.endsWith(".cfg")
            || lower.endsWith(".txt");
    }

    private static void extractKeywordHits(
        String entryName,
        byte[] bytes,
        JSONArray destination,
        Set<String> uniqueHits
    ) {
        StringBuilder run = new StringBuilder();
        for (int index = 0; index <= bytes.length; index++) {
            int value = index == bytes.length ? 0 : bytes[index] & 0xff;
            boolean printable = value >= 32 && value <= 126;
            if (printable) {
                if (run.length() < 2_048) run.append((char) value);
                continue;
            }
            if (run.length() >= 4) inspectString(entryName, run.toString(), destination, uniqueHits);
            run.setLength(0);
            if (destination.length() >= MAX_HITS) return;
        }
    }

    private static void inspectString(
        String entryName,
        String candidate,
        JSONArray destination,
        Set<String> uniqueHits
    ) {
        String lower = candidate.toLowerCase(Locale.US);
        for (String keyword : KEYWORDS) {
            int hitIndex = lower.indexOf(keyword);
            if (hitIndex < 0) continue;

            int start = Math.max(0, hitIndex - 80);
            int end = Math.min(candidate.length(), hitIndex + keyword.length() + 120);
            String sample = redact(candidate.substring(start, end));
            String uniquenessKey = entryName + "|" + keyword + "|" + sample;
            if (!uniqueHits.add(uniquenessKey)) return;

            JSONObject hit = new JSONObject();
            put(hit, "entry", entryName);
            put(hit, "keyword", keyword);
            put(hit, "sample", sample);
            destination.put(hit);
            return;
        }
    }

    private static String redact(String source) {
        String value = source.replaceAll("(?i)(authorization|password|passwd|secret|token|apikey|api_key)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
        value = value.replaceAll("(?i)https?://[^\\s]+", "[URL_REDACTED]");
        value = value.replaceAll("(?i)\\b[0-9a-f]{32,}\\b", "[HEX_REDACTED]");
        value = value.replaceAll("\\b[0-9]{10,}\\b", "[NUMBER_REDACTED]");
        value = value.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", " ").trim();
        return value.length() <= MAX_SAMPLE_LENGTH ? value : value.substring(0, MAX_SAMPLE_LENGTH) + "…";
    }

    private static byte[] readBounded(InputStream input, int maxBytes) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int remaining = maxBytes;
            while (remaining > 0) {
                int count = source.read(buffer, 0, Math.min(buffer.length, remaining));
                if (count < 0) break;
                output.write(buffer, 0, count);
                remaining -= count;
            }
            return output.toByteArray();
        }
    }

    private static String sha256(File file) throws Exception {
        try (InputStream input = new FileInputStream(file)) {
            return sha256(input);
        }
    }

    private static String sha256(InputStream input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[32 * 1024];
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (count > 0) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.US, "%02x", item & 0xff));
        return value.toString();
    }

    private static void put(JSONObject target, String key, Object value) {
        try {
            target.put(key, value == null ? JSONObject.NULL : value);
        } catch (Exception ignored) {
            // Only bounded primitive and JSON values are written.
        }
    }
}
