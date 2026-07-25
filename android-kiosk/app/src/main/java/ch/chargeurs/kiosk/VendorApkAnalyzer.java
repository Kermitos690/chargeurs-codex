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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Passive, bounded DEX inventory. Never executes vendor code or opens serial I/O. */
public final class VendorApkAnalyzer {
    private static final int MAX_ENTRIES = 8_000;
    private static final int MAX_DEX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_STRINGS = 1_200;
    private static final int MAX_CLASSES = 800;
    private static final int MAX_METHODS = 1_200;
    private static final int MAX_FIELDS = 800;
    private static final int MAX_NATIVE_BINARIES = 250;
    private static final int MAX_TEXT = 320;

    private static final List<String> PROFILE_TERMS = Arrays.asList(
        "/dev/ttyS1", "ttyS1", "CLOUDPOS_SERIAL", "com.fazecast.jSerialComm",
        "jSerialComm", "SerialPort", "getCommPort", "openPort", "closePort",
        "writeBytes", "readBytes", "bytesAvailable", "setComPortParameters",
        "setBaudRate", "setNumDataBits", "setNumStopBits", "setParity",
        "setComPortTimeouts", "addDataListener", "PaymentEndActivity",
        "initBatteryRental", "eject", "slot", "cabinet", "battery", "powerbank",
        "rs485", "uart", "crc16", "checksum", "9600", "19200", "38400",
        "57600", "115200"
    );

    private VendorApkAnalyzer() {}

    public static JSONObject analyze(Context context, String packageName) {
        return analyze(context, packageName, Collections.emptyList());
    }

    public static JSONObject analyze(Context context, String packageName, List<String> customTerms) {
        JSONObject result = new JSONObject();
        List<String> terms = mergeTerms(customTerms);
        put(result, "schemaVersion", 2);
        put(result, "profile", "DTA21269_TARGETED_DEX");
        put(result, "package", packageName);
        put(result, "generatedAt", System.currentTimeMillis());
        put(result, "profileTerms", new JSONArray(terms));
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
            put(result, "archive", inspectArchive(apk, terms));
            put(result, "status", "COMPLETED");
        } catch (PackageManager.NameNotFoundException error) {
            put(result, "status", "VENDOR_PACKAGE_NOT_FOUND");
            put(result, "error", error.getClass().getSimpleName());
        } catch (Exception error) {
            put(result, "status", "ANALYSIS_FAILED");
            put(result, "error", error.getClass().getSimpleName());
            put(result, "errorMessage", redact(String.valueOf(error.getMessage())));
        }
        return result;
    }

    private static JSONObject inspectArchive(File apk, List<String> terms) throws Exception {
        JSONObject archive = new JSONObject();
        JSONArray dexFiles = new JSONArray();
        JSONArray nativeBinaries = new JSONArray();
        JSONArray notableEntries = new JSONArray();
        JSONArray relevantStrings = new JSONArray();
        JSONArray candidateClasses = new JSONArray();
        JSONArray candidateMethods = new JSONArray();
        JSONArray candidateFields = new JSONArray();
        Set<String> stringKeys = new LinkedHashSet<>();
        Set<String> classKeys = new LinkedHashSet<>();
        Set<String> methodKeys = new LinkedHashSet<>();
        Set<String> fieldKeys = new LinkedHashSet<>();

        int entryCount = 0;
        int dexParsed = 0;
        long dexBytes = 0;
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

                if (isNativeBinary(lower) && nativeBinaries.length() < MAX_NATIVE_BINARIES) {
                    nativeBinaries.put(entryMetadata(zip, entry));
                }
                if (!isThirdPartyNoise(lower) && matchesAny(lower, terms) && notableEntries.length() < 300) {
                    notableEntries.put(name);
                }
                if (!lower.matches("classes[0-9]*\\.dex")) continue;

                byte[] bytes = readBounded(zip.getInputStream(entry), MAX_DEX_BYTES);
                dexBytes += bytes.length;
                dexParsed += 1;
                JSONObject dex = parseDex(
                    name,
                    bytes,
                    terms,
                    relevantStrings,
                    candidateClasses,
                    candidateMethods,
                    candidateFields,
                    stringKeys,
                    classKeys,
                    methodKeys,
                    fieldKeys
                );
                dexFiles.put(dex);
                if (relevantStrings.length() >= MAX_STRINGS
                    || candidateMethods.length() >= MAX_METHODS
                    || candidateFields.length() >= MAX_FIELDS) {
                    truncated = true;
                }
            }
        }

        put(archive, "entryCount", entryCount);
        put(archive, "dexParsed", dexParsed);
        put(archive, "dexBytesParsed", dexBytes);
        put(archive, "scanTruncated", truncated);
        put(archive, "thirdPartyNoiseExcluded", new JSONArray(Arrays.asList(
            "assets/com.stripe", "stripe.offlinemode", "google", "firebase"
        )));
        put(archive, "dexFiles", dexFiles);
        put(archive, "nativeBinaries", nativeBinaries);
        put(archive, "notableEntries", notableEntries);
        put(archive, "relevantStrings", relevantStrings);
        put(archive, "candidateClasses", candidateClasses);
        put(archive, "candidateMethods", candidateMethods);
        put(archive, "candidateFields", candidateFields);
        put(archive, "relevantStringCount", relevantStrings.length());
        put(archive, "candidateClassCount", candidateClasses.length());
        put(archive, "candidateMethodCount", candidateMethods.length());
        put(archive, "candidateFieldCount", candidateFields.length());
        return archive;
    }

    private static JSONObject parseDex(
        String entryName,
        byte[] data,
        List<String> terms,
        JSONArray relevantStrings,
        JSONArray candidateClasses,
        JSONArray candidateMethods,
        JSONArray candidateFields,
        Set<String> stringKeys,
        Set<String> classKeys,
        Set<String> methodKeys,
        Set<String> fieldKeys
    ) {
        JSONObject result = new JSONObject();
        put(result, "name", entryName);
        put(result, "size", data.length);
        try {
            if (data.length < 112 || data[0] != 'd' || data[1] != 'e' || data[2] != 'x') {
                throw new IllegalArgumentException("NOT_DEX");
            }

            int stringCount = u32(data, 0x38);
            int stringOffset = u32(data, 0x3c);
            int typeCount = u32(data, 0x40);
            int typeOffset = u32(data, 0x44);
            int protoCount = u32(data, 0x48);
            int protoOffset = u32(data, 0x4c);
            int fieldCount = u32(data, 0x50);
            int fieldOffset = u32(data, 0x54);
            int methodCount = u32(data, 0x58);
            int methodOffset = u32(data, 0x5c);

            checkTable(data, stringOffset, stringCount, 4);
            checkTable(data, typeOffset, typeCount, 4);
            checkTable(data, protoOffset, protoCount, 12);
            checkTable(data, fieldOffset, fieldCount, 8);
            checkTable(data, methodOffset, methodCount, 8);

            List<String> strings = new ArrayList<>(stringCount);
            for (int index = 0; index < stringCount; index++) {
                int valueOffset = u32(data, stringOffset + index * 4);
                strings.add(readDexString(data, valueOffset));
            }

            int[] typeStringIndexes = new int[typeCount];
            for (int index = 0; index < typeCount; index++) {
                typeStringIndexes[index] = u32(data, typeOffset + index * 4);
            }

            for (String value : strings) {
                if (relevantStrings.length() >= MAX_STRINGS) break;
                if (isThirdPartyNoise(value.toLowerCase(Locale.US))) continue;
                List<String> matched = matchedTerms(value, terms);
                if (matched.isEmpty()) continue;
                String clean = redact(value);
                String key = entryName + "|" + clean;
                if (!stringKeys.add(key)) continue;
                JSONObject item = new JSONObject();
                put(item, "dex", entryName);
                put(item, "value", clean);
                put(item, "matchedTerms", new JSONArray(matched));
                relevantStrings.put(item);
            }

            for (int index = 0; index < typeCount && candidateClasses.length() < MAX_CLASSES; index++) {
                String descriptor = typeDescriptor(strings, typeStringIndexes, index);
                if (!isCandidateClass(descriptor, terms)) continue;
                String key = entryName + "|" + descriptor;
                if (!classKeys.add(key)) continue;
                JSONObject item = new JSONObject();
                put(item, "dex", entryName);
                put(item, "descriptor", redact(descriptor));
                candidateClasses.put(item);
            }

            for (int index = 0; index < fieldCount && candidateFields.length() < MAX_FIELDS; index++) {
                int offset = fieldOffset + index * 8;
                int classIndex = u16(data, offset);
                int typeIndex = u16(data, offset + 2);
                int nameIndex = u32(data, offset + 4);
                String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
                String fieldType = typeDescriptor(strings, typeStringIndexes, typeIndex);
                String name = stringAt(strings, nameIndex);
                if (!isCandidateMember(owner, name, terms)) continue;
                String signature = owner + "->" + name + ":" + fieldType;
                if (!fieldKeys.add(entryName + "|" + signature)) continue;
                JSONObject item = new JSONObject();
                put(item, "dex", entryName);
                put(item, "owner", redact(owner));
                put(item, "name", redact(name));
                put(item, "type", redact(fieldType));
                put(item, "signature", redact(signature));
                candidateFields.put(item);
            }

            for (int index = 0; index < methodCount && candidateMethods.length() < MAX_METHODS; index++) {
                int offset = methodOffset + index * 8;
                int classIndex = u16(data, offset);
                int protoIndex = u16(data, offset + 2);
                int nameIndex = u32(data, offset + 4);
                String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
                String name = stringAt(strings, nameIndex);
                if (!isCandidateMember(owner, name, terms)) continue;
                String proto = protoSignature(data, strings, typeStringIndexes, protoOffset, protoCount, protoIndex);
                String signature = owner + "->" + name + proto;
                if (!methodKeys.add(entryName + "|" + signature)) continue;
                JSONObject item = new JSONObject();
                put(item, "dex", entryName);
                put(item, "owner", redact(owner));
                put(item, "name", redact(name));
                put(item, "prototype", redact(proto));
                put(item, "signature", redact(signature));
                put(item, "priority", methodPriority(owner, name));
                candidateMethods.put(item);
            }

            put(result, "status", "PARSED");
            put(result, "stringCount", stringCount);
            put(result, "typeCount", typeCount);
            put(result, "protoCount", protoCount);
            put(result, "fieldCount", fieldCount);
            put(result, "methodCount", methodCount);
        } catch (Exception error) {
            put(result, "status", "PARSE_FAILED");
            put(result, "error", error.getClass().getSimpleName());
            put(result, "errorMessage", redact(String.valueOf(error.getMessage())));
        }
        return result;
    }

    private static String protoSignature(
        byte[] data,
        List<String> strings,
        int[] typeStringIndexes,
        int protoOffset,
        int protoCount,
        int protoIndex
    ) {
        if (protoIndex < 0 || protoIndex >= protoCount) return "(?)?";
        int offset = protoOffset + protoIndex * 12;
        int returnTypeIndex = u32(data, offset + 4);
        int parametersOffset = u32(data, offset + 8);
        StringBuilder value = new StringBuilder("(");
        if (parametersOffset != 0 && parametersOffset + 4 <= data.length) {
            int count = u32(data, parametersOffset);
            int max = Math.min(count, 64);
            if (parametersOffset + 4L + max * 2L <= data.length) {
                for (int index = 0; index < max; index++) {
                    int typeIndex = u16(data, parametersOffset + 4 + index * 2);
                    value.append(typeDescriptor(strings, typeStringIndexes, typeIndex));
                }
            }
        }
        value.append(')').append(typeDescriptor(strings, typeStringIndexes, returnTypeIndex));
        return value.toString();
    }

    private static String readDexString(byte[] data, int offset) {
        if (offset < 0 || offset >= data.length) return "";
        int position = offset;
        for (int index = 0; index < 5 && position < data.length; index++) {
            int value = data[position++] & 0xff;
            if ((value & 0x80) == 0) break;
        }
        int end = position;
        int limit = Math.min(data.length, position + 16_384);
        while (end < limit && data[end] != 0) end++;
        return new String(data, position, Math.max(0, end - position), StandardCharsets.UTF_8);
    }

    private static String typeDescriptor(List<String> strings, int[] typeStringIndexes, int typeIndex) {
        if (typeIndex < 0 || typeIndex >= typeStringIndexes.length) return "?";
        return stringAt(strings, typeStringIndexes[typeIndex]);
    }

    private static String stringAt(List<String> strings, int index) {
        return index >= 0 && index < strings.size() ? strings.get(index) : "?";
    }

    private static boolean isCandidateClass(String value, List<String> terms) {
        String lower = value.toLowerCase(Locale.US);
        return lower.startsWith("lcom/szbjkj/bajietouchpower/")
            || lower.startsWith("lcom/fazecast/jserialcomm/")
            || lower.contains("paymentendactivity")
            || lower.contains("batteryrental")
            || matchesAny(lower, terms);
    }

    private static boolean isCandidateMember(String owner, String name, List<String> terms) {
        String combined = owner + " " + name;
        String lowerOwner = owner.toLowerCase(Locale.US);
        boolean vendor = lowerOwner.startsWith("lcom/szbjkj/bajietouchpower/");
        boolean serialLibrary = lowerOwner.startsWith("lcom/fazecast/jserialcomm/");
        return serialLibrary || matchesAny(combined, terms)
            || (vendor && matchesAny(name, Arrays.asList(
                "init", "rent", "take", "return", "out", "open", "write", "read",
                "send", "serial", "port", "battery", "slot", "eject", "cabinet", "crc"
            )));
    }

    private static String methodPriority(String owner, String name) {
        String lower = (owner + " " + name).toLowerCase(Locale.US);
        if (lower.contains("writebytes") || lower.contains("setcomportparameters")
            || lower.contains("getcommport") || lower.contains("openport")
            || lower.contains("paymentendactivity") || lower.contains("initbatteryrental")) {
            return "HIGH";
        }
        if (lower.contains("serial") || lower.contains("battery") || lower.contains("slot")
            || lower.contains("eject") || lower.contains("cabinet")) {
            return "MEDIUM";
        }
        return "LOW";
    }

    private static List<String> mergeTerms(List<String> customTerms) {
        Set<String> values = new LinkedHashSet<>(PROFILE_TERMS);
        if (customTerms != null) {
            for (String term : customTerms) {
                if (term == null) continue;
                String clean = term.trim();
                if (!clean.isEmpty() && clean.length() <= 120) values.add(clean);
            }
        }
        return new ArrayList<>(values);
    }

    private static List<String> matchedTerms(String value, List<String> terms) {
        List<String> matched = new ArrayList<>();
        String lower = value.toLowerCase(Locale.US);
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(Locale.US))) matched.add(term);
            if (matched.size() >= 12) break;
        }
        return matched;
    }

    private static boolean matchesAny(String value, List<String> terms) {
        String lower = value.toLowerCase(Locale.US);
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(Locale.US))) return true;
        }
        return false;
    }

    private static boolean isThirdPartyNoise(String lower) {
        return lower.contains("com.stripe") || lower.contains("stripe.offlinemode")
            || lower.contains("firebase") || lower.contains("com.google.android.gms");
    }

    private static boolean isNativeBinary(String lower) {
        return lower.endsWith(".so") || lower.endsWith(".dll") || lower.endsWith(".jnilib")
            || lower.contains("jserialcomm");
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

    private static void checkTable(byte[] data, int offset, int count, int itemSize) {
        if (offset < 0 || count < 0 || offset + (long) count * itemSize > data.length) {
            throw new IllegalArgumentException("DEX_TABLE_OUT_OF_RANGE");
        }
    }

    private static int u16(byte[] data, int offset) {
        if (offset < 0 || offset + 2 > data.length) throw new IllegalArgumentException("DEX_U16_RANGE");
        return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8);
    }

    private static int u32(byte[] data, int offset) {
        if (offset < 0 || offset + 4 > data.length) throw new IllegalArgumentException("DEX_U32_RANGE");
        long value = (data[offset] & 0xffL)
            | ((data[offset + 1] & 0xffL) << 8)
            | ((data[offset + 2] & 0xffL) << 16)
            | ((data[offset + 3] & 0xffL) << 24);
        if (value > Integer.MAX_VALUE) throw new IllegalArgumentException("DEX_U32_TOO_LARGE");
        return (int) value;
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

    private static String redact(String source) {
        if (source == null) return "";
        String value = source.replaceAll("(?i)(authorization|password|passwd|secret|token|apikey|api_key)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
        value = value.replaceAll("(?i)https?://[^\\s]+", "[URL_REDACTED]");
        value = value.replaceAll("(?i)\\b[0-9a-f]{40,}\\b", "[HEX_REDACTED]");
        value = value.replaceAll("\\b[0-9]{12,}\\b", "[NUMBER_REDACTED]");
        value = value.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", " ").trim();
        return value.length() <= MAX_TEXT ? value : value.substring(0, MAX_TEXT) + "…";
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
            // Bounded primitive and JSON values only.
        }
    }
}
