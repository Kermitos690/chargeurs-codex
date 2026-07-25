package ch.chargeurs.kiosk;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Passive DEX call-graph analysis for the vendor APK.
 *
 * This class never executes vendor code, never opens a serial device and never writes bytes.
 * It only reads the installed APK archive and decodes bounded DEX metadata and invoke opcodes.
 */
public final class VendorDexCallGraphAnalyzer {
    private static final int MAX_DEX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_STRING_IDS = 350_000;
    private static final int MAX_METHOD_IDS = 250_000;
    private static final int MAX_CLASS_DEFS = 80_000;
    private static final int MAX_PARSED_CODE_METHODS = 30_000;
    private static final int MAX_CODE_UNITS = 8_000_000;
    private static final int MAX_GRAPH_EDGES = 100_000;
    private static final int MAX_METHOD_EVIDENCE = 1_000;
    private static final int MAX_RELEVANT_EDGES = 1_500;
    private static final int MAX_PATHS = 120;
    private static final int MAX_PATH_DEPTH = 9;
    private static final int MAX_NEIGHBORHOOD_DEPTH = 4;
    private static final int MAX_TEXT = 420;

    private static final String VENDOR_PREFIX = "Lcom/szbjkj/bajietouchpower/";

    private static final List<String> ROOT_TERMS = Arrays.asList(
        "PaymentEndActivity", "initBatteryRental"
    );

    private static final List<String> SINK_TERMS = Arrays.asList(
        "writeBytes", "readBytes", "getCommPort", "openPort", "closePort",
        "setComPortParameters", "setBaudRate", "setNumDataBits", "setNumStopBits",
        "setParity", "setComPortTimeouts"
    );

    private static final List<String> DEFAULT_TERMS = Arrays.asList(
        "/dev/ttyS1", "ttyS1", "CLOUDPOS_SERIAL", "PaymentEndActivity",
        "initBatteryRental", "writeBytes", "readBytes", "getCommPort", "openPort",
        "closePort", "setComPortParameters", "setBaudRate", "setNumDataBits",
        "setNumStopBits", "setParity", "setComPortTimeouts", "addDataListener",
        "jSerialComm", "SerialPort", "eject", "slot", "cabinet", "battery",
        "powerbank", "rent", "return", "rs485", "uart", "crc16", "checksum",
        "9600", "19200", "38400", "57600", "115200", "AT+"
    );

    private VendorDexCallGraphAnalyzer() {}

    public static JSONObject analyze(Context context, String packageName, List<String> customTerms) {
        JSONObject result = new JSONObject();
        put(result, "schemaVersion", 3);
        put(result, "profile", "DTA21269_DEX_CALL_GRAPH");
        put(result, "package", packageName);
        put(result, "generatedAt", System.currentTimeMillis());
        put(result, "safeReadOnly", true);
        put(result, "vendorCodeExecuted", false);
        put(result, "serialPortOpened", false);
        put(result, "serialBytesWritten", 0);
        put(result, "physicalEjectionEnabled", false);
        put(result, "protocolSolved", false);
        put(result, "payloadRecovered", false);

        List<String> terms = mergeTerms(customTerms);
        put(result, "profileTerms", new JSONArray(terms));

        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(packageName, 0);
            File apk = new File(info.sourceDir);
            put(result, "sourceReadable", apk.isFile() && apk.canRead());
            put(result, "apkSizeBytes", apk.length());
            put(result, "sourcePathBasename", apk.getName());

            GraphState graph = new GraphState(terms);
            JSONArray dexFiles = inspectArchive(apk, graph);
            JSONObject graphJson = graph.toJson();
            put(graphJson, "dexFiles", dexFiles);
            put(result, "graph", graphJson);
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

    private static JSONArray inspectArchive(File apk, GraphState graph) throws Exception {
        JSONArray dexFiles = new JSONArray();
        try (ZipFile zip = new ZipFile(apk)) {
            List<ZipEntry> entries = new ArrayList<>();
            zip.stream()
                .filter(entry -> !entry.isDirectory())
                .filter(entry -> entry.getName().toLowerCase(Locale.US).matches("classes[0-9]*\\.dex"))
                .forEach(entries::add);
            entries.sort(Comparator.comparing(ZipEntry::getName));

            for (ZipEntry entry : entries) {
                byte[] data = readBounded(zip.getInputStream(entry), MAX_DEX_BYTES);
                dexFiles.put(parseDex(entry.getName(), data, graph));
            }
        }
        return dexFiles;
    }

    private static JSONObject parseDex(String dexName, byte[] data, GraphState graph) {
        JSONObject result = new JSONObject();
        put(result, "name", dexName);
        put(result, "size", data.length);

        int methodsBefore = graph.parsedCodeMethods;
        int edgesBefore = graph.edgeCount;
        int evidenceBefore = graph.methodEvidence.size();
        int stringsBefore = graph.relevantStringReferenceCount;
        int codeUnitsBefore = graph.codeUnitsScanned;

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
            int methodCount = u32(data, 0x58);
            int methodOffset = u32(data, 0x5c);
            int classCount = u32(data, 0x60);
            int classOffset = u32(data, 0x64);

            if (stringCount > MAX_STRING_IDS) throw new IllegalArgumentException("STRING_TABLE_TOO_LARGE");
            if (methodCount > MAX_METHOD_IDS) throw new IllegalArgumentException("METHOD_TABLE_TOO_LARGE");
            if (classCount > MAX_CLASS_DEFS) throw new IllegalArgumentException("CLASS_TABLE_TOO_LARGE");

            checkTable(data, stringOffset, stringCount, 4);
            checkTable(data, typeOffset, typeCount, 4);
            checkTable(data, protoOffset, protoCount, 12);
            checkTable(data, methodOffset, methodCount, 8);
            checkTable(data, classOffset, classCount, 32);

            List<String> strings = readStrings(data, stringOffset, stringCount);
            int[] typeStringIndexes = readTypeIndexes(data, typeOffset, typeCount);
            MethodRef[] methods = readMethodRefs(
                data,
                strings,
                typeStringIndexes,
                protoOffset,
                protoCount,
                methodOffset,
                methodCount
            );

            for (int index = 0; index < classCount; index++) {
                if (graph.isGloballyTruncated()) break;
                int offset = classOffset + index * 32;
                int classIndex = u32(data, offset);
                int classDataOffset = u32(data, offset + 24);
                if (classDataOffset == 0) continue;
                String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
                if (!shouldParseClass(owner, graph.terms)) continue;
                parseClassData(dexName, data, classDataOffset, owner, strings, methods, graph);
            }

            put(result, "status", "PARSED");
            put(result, "stringCount", stringCount);
            put(result, "typeCount", typeCount);
            put(result, "protoCount", protoCount);
            put(result, "methodCount", methodCount);
            put(result, "classCount", classCount);
        } catch (Exception error) {
            put(result, "status", "PARSE_FAILED");
            put(result, "error", error.getClass().getSimpleName());
            put(result, "errorMessage", redact(String.valueOf(error.getMessage())));
        }

        put(result, "parsedCodeMethods", graph.parsedCodeMethods - methodsBefore);
        put(result, "invokeEdges", graph.edgeCount - edgesBefore);
        put(result, "methodEvidence", graph.methodEvidence.size() - evidenceBefore);
        put(result, "relevantStringReferences", graph.relevantStringReferenceCount - stringsBefore);
        put(result, "codeUnitsScanned", graph.codeUnitsScanned - codeUnitsBefore);
        put(result, "truncated", graph.isGloballyTruncated());
        return result;
    }

    private static List<String> readStrings(byte[] data, int stringOffset, int stringCount) {
        List<String> strings = new ArrayList<>(stringCount);
        for (int index = 0; index < stringCount; index++) {
            int valueOffset = u32(data, stringOffset + index * 4);
            strings.add(readDexString(data, valueOffset));
        }
        return strings;
    }

    private static int[] readTypeIndexes(byte[] data, int typeOffset, int typeCount) {
        int[] typeStringIndexes = new int[typeCount];
        for (int index = 0; index < typeCount; index++) {
            typeStringIndexes[index] = u32(data, typeOffset + index * 4);
        }
        return typeStringIndexes;
    }

    private static MethodRef[] readMethodRefs(
        byte[] data,
        List<String> strings,
        int[] typeStringIndexes,
        int protoOffset,
        int protoCount,
        int methodOffset,
        int methodCount
    ) {
        MethodRef[] methods = new MethodRef[methodCount];
        for (int index = 0; index < methodCount; index++) {
            int offset = methodOffset + index * 8;
            int classIndex = u16(data, offset);
            int protoIndex = u16(data, offset + 2);
            int nameIndex = u32(data, offset + 4);
            String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
            String name = stringAt(strings, nameIndex);
            String prototype = protoSignature(
                data,
                strings,
                typeStringIndexes,
                protoOffset,
                protoCount,
                protoIndex
            );
            methods[index] = new MethodRef(owner, name, prototype);
        }
        return methods;
    }

    private static void parseClassData(
        String dexName,
        byte[] data,
        int classDataOffset,
        String owner,
        List<String> strings,
        MethodRef[] methods,
        GraphState graph
    ) {
        Cursor cursor = new Cursor(classDataOffset);
        int staticFields = readUleb128(data, cursor);
        int instanceFields = readUleb128(data, cursor);
        int directMethods = readUleb128(data, cursor);
        int virtualMethods = readUleb128(data, cursor);

        skipEncodedFields(data, cursor, staticFields);
        skipEncodedFields(data, cursor, instanceFields);
        parseEncodedMethods(dexName, data, cursor, directMethods, owner, strings, methods, graph);
        parseEncodedMethods(dexName, data, cursor, virtualMethods, owner, strings, methods, graph);
    }

    private static void skipEncodedFields(byte[] data, Cursor cursor, int count) {
        for (int index = 0; index < count; index++) {
            readUleb128(data, cursor);
            readUleb128(data, cursor);
        }
    }

    private static void parseEncodedMethods(
        String dexName,
        byte[] data,
        Cursor cursor,
        int count,
        String owner,
        List<String> strings,
        MethodRef[] methods,
        GraphState graph
    ) {
        int methodIndex = 0;
        for (int index = 0; index < count; index++) {
            methodIndex += readUleb128(data, cursor);
            readUleb128(data, cursor);
            int codeOffset = readUleb128(data, cursor);

            if (methodIndex < 0 || methodIndex >= methods.length) {
                throw new IllegalArgumentException("METHOD_INDEX_OUT_OF_RANGE");
            }
            MethodRef method = methods[methodIndex];
            if (method == null || codeOffset == 0 || graph.isGloballyTruncated()) continue;
            if (!owner.equals(method.owner)) continue;
            scanCodeItem(dexName, data, codeOffset, method, strings, methods, graph);
        }
    }

    private static void scanCodeItem(
        String dexName,
        byte[] data,
        int codeOffset,
        MethodRef caller,
        List<String> strings,
        MethodRef[] methods,
        GraphState graph
    ) {
        if (codeOffset < 0 || codeOffset + 16 > data.length) {
            throw new IllegalArgumentException("CODE_ITEM_OUT_OF_RANGE");
        }
        int insnsSize = u32(data, codeOffset + 12);
        long codeEnd = codeOffset + 16L + insnsSize * 2L;
        if (insnsSize < 0 || codeEnd > data.length) {
            throw new IllegalArgumentException("INSNS_OUT_OF_RANGE");
        }

        graph.parsedCodeMethods++;
        graph.codeUnitsScanned += insnsSize;
        graph.definedMethods.add(caller.signature);

        MethodEvidence evidence = null;
        int insnsOffset = codeOffset + 16;
        int cursor = 0;
        while (cursor < insnsSize) {
            if (graph.isGloballyTruncated()) break;
            int unit = u16(data, insnsOffset + cursor * 2);
            int opcode = unit & 0xff;

            if (isInvokeMethodOpcode(opcode) && cursor + 1 < insnsSize) {
                int methodIndex = u16(data, insnsOffset + (cursor + 1) * 2);
                if (methodIndex >= 0 && methodIndex < methods.length && methods[methodIndex] != null) {
                    MethodRef callee = methods[methodIndex];
                    graph.addEdge(caller.signature, callee.signature);
                    if (isRelevantSignature(caller.signature, graph.terms)
                        || isRelevantSignature(callee.signature, graph.terms)) {
                        evidence = graph.evidenceFor(dexName, caller);
                        evidence.addInvoke(callee.signature);
                    }
                }
            } else if (opcode == 0x1a && cursor + 1 < insnsSize) {
                int stringIndex = u16(data, insnsOffset + (cursor + 1) * 2);
                if (stringIndex >= 0 && stringIndex < strings.size()) {
                    String value = strings.get(stringIndex);
                    List<String> matched = matchedTerms(value, graph.terms);
                    if (!matched.isEmpty()) {
                        evidence = graph.evidenceFor(dexName, caller);
                        evidence.addString(value, matched);
                        graph.relevantStringReferenceCount++;
                    }
                }
            } else if (opcode == 0x1b && cursor + 2 < insnsSize) {
                int stringIndex = u32(data, insnsOffset + (cursor + 1) * 2);
                if (stringIndex >= 0 && stringIndex < strings.size()) {
                    String value = strings.get(stringIndex);
                    List<String> matched = matchedTerms(value, graph.terms);
                    if (!matched.isEmpty()) {
                        evidence = graph.evidenceFor(dexName, caller);
                        evidence.addString(value, matched);
                        graph.relevantStringReferenceCount++;
                    }
                }
            }

            int width = instructionWidth(data, insnsOffset, cursor, insnsSize);
            if (width <= 0 || cursor + width > insnsSize) {
                graph.decodeErrors++;
                width = 1;
            }
            cursor += width;
        }

        if (evidence != null) evidence.codeUnits = insnsSize;
    }

    static int instructionWidth(byte[] data, int insnsOffset, int cursor, int insnsSize) {
        int unit = u16(data, insnsOffset + cursor * 2);
        int opcode = unit & 0xff;
        int high = (unit >>> 8) & 0xff;

        if (opcode == 0x00 && high != 0x00) {
            if (high == 0x01) {
                if (cursor + 2 > insnsSize) return 1;
                int size = u16(data, insnsOffset + (cursor + 1) * 2);
                return 4 + size * 2;
            }
            if (high == 0x02) {
                if (cursor + 2 > insnsSize) return 1;
                int size = u16(data, insnsOffset + (cursor + 1) * 2);
                return 2 + size * 4;
            }
            if (high == 0x03) {
                if (cursor + 4 > insnsSize) return 1;
                int elementWidth = u16(data, insnsOffset + (cursor + 1) * 2);
                long size = u32(data, insnsOffset + (cursor + 2) * 2);
                long dataUnits = (elementWidth * size + 1L) / 2L;
                long width = 4L + dataUnits;
                return width > Integer.MAX_VALUE ? 1 : (int) width;
            }
            return 1;
        }

        switch (opcode) {
            case 0x02:
            case 0x05:
            case 0x08:
            case 0x13:
            case 0x15:
            case 0x16:
            case 0x19:
            case 0x1a:
            case 0x1c:
            case 0x1f:
            case 0x20:
            case 0x22:
            case 0x23:
            case 0x29:
            case 0x2d:
            case 0x2e:
            case 0x2f:
            case 0x30:
            case 0x31:
            case 0x32:
            case 0x33:
            case 0x34:
            case 0x35:
            case 0x36:
            case 0x37:
            case 0x38:
            case 0x39:
            case 0x3a:
            case 0x3b:
            case 0x3c:
            case 0x3d:
            case 0x44:
            case 0x45:
            case 0x46:
            case 0x47:
            case 0x48:
            case 0x49:
            case 0x4a:
            case 0x4b:
            case 0x4c:
            case 0x4d:
            case 0x4e:
            case 0x4f:
            case 0x50:
            case 0x51:
            case 0x52:
            case 0x53:
            case 0x54:
            case 0x55:
            case 0x56:
            case 0x57:
            case 0x58:
            case 0x59:
            case 0x5a:
            case 0x5b:
            case 0x5c:
            case 0x5d:
            case 0x5e:
            case 0x5f:
            case 0x60:
            case 0x61:
            case 0x62:
            case 0x63:
            case 0x64:
            case 0x65:
            case 0x66:
            case 0x67:
            case 0x68:
            case 0x69:
            case 0x6a:
            case 0x6b:
            case 0x6c:
            case 0x6d:
            case 0x90:
            case 0x91:
            case 0x92:
            case 0x93:
            case 0x94:
            case 0x95:
            case 0x96:
            case 0x97:
            case 0x98:
            case 0x99:
            case 0x9a:
            case 0x9b:
            case 0x9c:
            case 0x9d:
            case 0x9e:
            case 0x9f:
            case 0xa0:
            case 0xa1:
            case 0xa2:
            case 0xa3:
            case 0xa4:
            case 0xa5:
            case 0xa6:
            case 0xa7:
            case 0xa8:
            case 0xa9:
            case 0xaa:
            case 0xab:
            case 0xac:
            case 0xad:
            case 0xae:
            case 0xaf:
            case 0xd0:
            case 0xd1:
            case 0xd2:
            case 0xd3:
            case 0xd4:
            case 0xd5:
            case 0xd6:
            case 0xd7:
            case 0xd8:
            case 0xd9:
            case 0xda:
            case 0xdb:
            case 0xdc:
            case 0xdd:
            case 0xde:
            case 0xdf:
            case 0xe0:
            case 0xe1:
            case 0xe2:
            case 0xfe:
            case 0xff:
                return 2;

            case 0x03:
            case 0x06:
            case 0x09:
            case 0x14:
            case 0x17:
            case 0x1b:
            case 0x24:
            case 0x25:
            case 0x26:
            case 0x2a:
            case 0x2b:
            case 0x2c:
            case 0x6e:
            case 0x6f:
            case 0x70:
            case 0x71:
            case 0x72:
            case 0x74:
            case 0x75:
            case 0x76:
            case 0x77:
            case 0x78:
            case 0xfc:
            case 0xfd:
                return 3;

            case 0xfa:
            case 0xfb:
                return 4;

            case 0x18:
                return 5;

            default:
                return 1;
        }
    }

    private static boolean isInvokeMethodOpcode(int opcode) {
        return (opcode >= 0x6e && opcode <= 0x72)
            || (opcode >= 0x74 && opcode <= 0x78)
            || opcode == 0xfa
            || opcode == 0xfb;
    }

    private static boolean shouldParseClass(String owner, List<String> terms) {
        if (owner == null || owner.isEmpty() || owner.equals("?")) return false;
        if (owner.startsWith(VENDOR_PREFIX)) return true;
        if (isRelevantSignature(owner, terms)) return true;
        String lower = owner.toLowerCase(Locale.US);
        return !lower.startsWith("landroid/")
            && !lower.startsWith("landroidx/")
            && !lower.startsWith("ljava/")
            && !lower.startsWith("ljavax/")
            && !lower.startsWith("lkotlin/")
            && !lower.startsWith("lkotlinx/")
            && !lower.startsWith("lcom/google/")
            && !lower.startsWith("lcom/android/")
            && !lower.startsWith("lcom/stripe/")
            && !lower.startsWith("lcom/fazecast/")
            && !lower.startsWith("lokhttp3/")
            && !lower.startsWith("lokio/")
            && !lower.startsWith("lretrofit2/")
            && !lower.startsWith("lorg/json/")
            && !lower.startsWith("lorg/apache/")
            && !lower.startsWith("ljunit/");
    }

    private static boolean isRelevantSignature(String value, List<String> terms) {
        String lower = value.toLowerCase(Locale.US);
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(Locale.US))) return true;
        }
        return false;
    }

    private static boolean containsAny(String value, List<String> terms) {
        String lower = value.toLowerCase(Locale.US);
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(Locale.US))) return true;
        }
        return false;
    }

    private static List<String> mergeTerms(List<String> customTerms) {
        Set<String> result = new LinkedHashSet<>(DEFAULT_TERMS);
        if (customTerms != null) {
            for (String term : customTerms) {
                if (term == null) continue;
                String clean = term.trim();
                if (!clean.isEmpty() && clean.length() <= 120) result.add(clean);
            }
        }
        return new ArrayList<>(result);
    }

    private static List<String> matchedTerms(String value, List<String> terms) {
        List<String> matched = new ArrayList<>();
        String lower = value.toLowerCase(Locale.US);
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(Locale.US))) matched.add(term);
            if (matched.size() >= 16) break;
        }
        return matched;
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
            int max = Math.min(count, 96);
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
        int limit = Math.min(data.length, position + 32_768);
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

    private static int readUleb128(byte[] data, Cursor cursor) {
        int result = 0;
        int shift = 0;
        for (int index = 0; index < 5; index++) {
            if (cursor.offset < 0 || cursor.offset >= data.length) {
                throw new IllegalArgumentException("ULEB128_OUT_OF_RANGE");
            }
            int value = data[cursor.offset++] & 0xff;
            result |= (value & 0x7f) << shift;
            if ((value & 0x80) == 0) return result;
            shift += 7;
        }
        throw new IllegalArgumentException("ULEB128_TOO_LONG");
    }

    private static void checkTable(byte[] data, int offset, int count, int itemSize) {
        if (offset < 0 || count < 0 || offset + (long) count * itemSize > data.length) {
            throw new IllegalArgumentException("DEX_TABLE_OUT_OF_RANGE");
        }
    }

    private static int u16(byte[] data, int offset) {
        if (offset < 0 || offset + 2 > data.length) {
            throw new IllegalArgumentException("DEX_U16_RANGE");
        }
        return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8);
    }

    private static int u32(byte[] data, int offset) {
        if (offset < 0 || offset + 4 > data.length) {
            throw new IllegalArgumentException("DEX_U32_RANGE");
        }
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
        String value = source
            .replaceAll("(?i)(authorization|password|passwd|secret|token|apikey|api_key)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]")
            .replaceAll("(?i)https?://[^\\s]+", "[URL_REDACTED]")
            .replaceAll("(?i)\\b[0-9a-f]{40,}\\b", "[HEX_REDACTED]")
            .replaceAll("\\b[0-9]{12,}\\b", "[NUMBER_REDACTED]")
            .replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", " ")
            .trim();
        return value.length() <= MAX_TEXT ? value : value.substring(0, MAX_TEXT) + "…";
    }

    private static void put(JSONObject target, String key, Object value) {
        try {
            target.put(key, value == null ? JSONObject.NULL : value);
        } catch (Exception ignored) {
            // Bounded primitive and JSON values only.
        }
    }

    private static final class Cursor {
        int offset;

        Cursor(int offset) {
            this.offset = offset;
        }
    }

    private static final class MethodRef {
        final String owner;
        final String name;
        final String prototype;
        final String signature;

        MethodRef(String owner, String name, String prototype) {
            this.owner = owner;
            this.name = name;
            this.prototype = prototype;
            this.signature = owner + "->" + name + prototype;
        }
    }

    private static final class MethodEvidence {
        final String dex;
        final String method;
        final Set<String> invokes = new LinkedHashSet<>();
        final List<JSONObject> strings = new ArrayList<>();
        int codeUnits;

        MethodEvidence(String dex, String method) {
            this.dex = dex;
            this.method = method;
        }

        void addInvoke(String signature) {
            if (invokes.size() < 50) invokes.add(signature);
        }

        void addString(String value, List<String> matchedTerms) {
            if (strings.size() >= 30) return;
            JSONObject item = new JSONObject();
            put(item, "value", redact(value));
            put(item, "matchedTerms", new JSONArray(matchedTerms));
            strings.add(item);
        }

        JSONObject toJson() {
            JSONObject item = new JSONObject();
            put(item, "dex", dex);
            put(item, "method", redact(method));
            put(item, "codeUnits", codeUnits);
            put(item, "invokes", new JSONArray(invokes));
            JSONArray stringItems = new JSONArray();
            for (JSONObject value : strings) stringItems.put(value);
            put(item, "strings", stringItems);
            return item;
        }
    }

    private static final class GraphState {
        final List<String> terms;
        final Map<String, LinkedHashSet<String>> outgoing = new LinkedHashMap<>();
        final Map<String, LinkedHashSet<String>> incoming = new LinkedHashMap<>();
        final Set<String> definedMethods = new LinkedHashSet<>();
        final Map<String, MethodEvidence> methodEvidence = new LinkedHashMap<>();
        int parsedCodeMethods;
        int codeUnitsScanned;
        int edgeCount;
        int decodeErrors;
        int relevantStringReferenceCount;

        GraphState(List<String> terms) {
            this.terms = terms;
        }

        boolean isGloballyTruncated() {
            return parsedCodeMethods >= MAX_PARSED_CODE_METHODS
                || codeUnitsScanned >= MAX_CODE_UNITS
                || edgeCount >= MAX_GRAPH_EDGES;
        }

        void addEdge(String caller, String callee) {
            LinkedHashSet<String> callees = outgoing.computeIfAbsent(caller, ignored -> new LinkedHashSet<>());
            if (!callees.add(callee)) return;
            incoming.computeIfAbsent(callee, ignored -> new LinkedHashSet<>()).add(caller);
            edgeCount++;
        }

        MethodEvidence evidenceFor(String dex, MethodRef method) {
            MethodEvidence existing = methodEvidence.get(method.signature);
            if (existing != null) return existing;
            if (methodEvidence.size() >= MAX_METHOD_EVIDENCE) {
                return new MethodEvidence(dex, method.signature);
            }
            MethodEvidence created = new MethodEvidence(dex, method.signature);
            methodEvidence.put(method.signature, created);
            return created;
        }

        JSONObject toJson() {
            JSONObject result = new JSONObject();
            List<String> roots = findMatchingMethods(ROOT_TERMS);
            List<String> sinks = findMatchingMethods(SINK_TERMS);
            List<List<String>> paths = findPaths(roots, sinks);
            Set<String> neighborhood = buildNeighborhood(roots, sinks);

            put(result, "definedMethodCount", definedMethods.size());
            put(result, "parsedCodeMethods", parsedCodeMethods);
            put(result, "codeUnitsScanned", codeUnitsScanned);
            put(result, "invokeEdgeCount", edgeCount);
            put(result, "decodeErrors", decodeErrors);
            put(result, "relevantStringReferenceCount", relevantStringReferenceCount);
            put(result, "graphTruncated", isGloballyTruncated());
            put(result, "roots", new JSONArray(roots));
            put(result, "sinks", new JSONArray(sinks));
            put(result, "rootCount", roots.size());
            put(result, "sinkCount", sinks.size());

            JSONArray pathItems = new JSONArray();
            for (List<String> path : paths) {
                JSONObject item = new JSONObject();
                put(item, "depth", Math.max(0, path.size() - 1));
                put(item, "methods", new JSONArray(path));
                pathItems.put(item);
            }
            put(result, "paths", pathItems);
            put(result, "pathCount", paths.size());
            put(result, "pathStatus", pathStatus(roots, sinks, paths));

            JSONArray edges = new JSONArray();
            int edgeItems = 0;
            for (Map.Entry<String, LinkedHashSet<String>> entry : outgoing.entrySet()) {
                for (String callee : entry.getValue()) {
                    if (edgeItems >= MAX_RELEVANT_EDGES) break;
                    if (!neighborhood.contains(entry.getKey()) && !neighborhood.contains(callee)) continue;
                    JSONObject edge = new JSONObject();
                    put(edge, "caller", redact(entry.getKey()));
                    put(edge, "callee", redact(callee));
                    edges.put(edge);
                    edgeItems++;
                }
                if (edgeItems >= MAX_RELEVANT_EDGES) break;
            }
            put(result, "relevantEdges", edges);
            put(result, "relevantEdgeCount", edgeItems);

            JSONArray evidence = new JSONArray();
            for (MethodEvidence item : methodEvidence.values()) {
                if (evidence.length() >= MAX_METHOD_EVIDENCE) break;
                if (neighborhood.contains(item.method)
                    || containsAny(item.method, ROOT_TERMS)
                    || containsAny(item.method, SINK_TERMS)
                    || !item.strings.isEmpty()) {
                    evidence.put(item.toJson());
                }
            }
            put(result, "methodEvidence", evidence);
            put(result, "protocolSolved", false);
            put(result, "payloadRecovered", false);
            put(result, "serialBytesWritten", 0);
            return result;
        }

        private List<String> findMatchingMethods(List<String> matchTerms) {
            Set<String> candidates = new LinkedHashSet<>();
            candidates.addAll(definedMethods);
            candidates.addAll(outgoing.keySet());
            candidates.addAll(incoming.keySet());
            List<String> result = new ArrayList<>();
            for (String method : candidates) {
                if (containsAny(method, matchTerms)) result.add(method);
            }
            result.sort((left, right) -> {
                int leftRank = methodRank(left, matchTerms);
                int rightRank = methodRank(right, matchTerms);
                if (leftRank != rightRank) return Integer.compare(leftRank, rightRank);
                return left.compareTo(right);
            });
            return result;
        }

        private int methodRank(String method, List<String> matchTerms) {
            String lower = method.toLowerCase(Locale.US);
            for (int index = 0; index < matchTerms.size(); index++) {
                if (lower.contains(matchTerms.get(index).toLowerCase(Locale.US))) return index;
            }
            return matchTerms.size();
        }

        private List<List<String>> findPaths(List<String> roots, List<String> sinks) {
            Set<String> sinkSet = new HashSet<>(sinks);
            List<List<String>> result = new ArrayList<>();
            for (String root : roots) {
                if (result.size() >= MAX_PATHS) break;
                Deque<List<String>> queue = new ArrayDeque<>();
                queue.add(Collections.singletonList(root));
                Set<String> bestDepth = new HashSet<>();
                while (!queue.isEmpty() && result.size() < MAX_PATHS) {
                    List<String> path = queue.removeFirst();
                    String current = path.get(path.size() - 1);
                    int depth = path.size() - 1;
                    String depthKey = current + "@" + depth;
                    if (!bestDepth.add(depthKey)) continue;
                    if (depth > 0 && sinkSet.contains(current)) {
                        result.add(path);
                        continue;
                    }
                    if (depth >= MAX_PATH_DEPTH) continue;
                    Set<String> next = outgoing.get(current);
                    if (next == null) continue;
                    for (String callee : next) {
                        if (path.contains(callee)) continue;
                        List<String> extended = new ArrayList<>(path);
                        extended.add(callee);
                        queue.addLast(extended);
                    }
                }
            }
            result.sort(Comparator.comparingInt(List::size));
            return result;
        }

        private Set<String> buildNeighborhood(List<String> roots, List<String> sinks) {
            Set<String> result = new LinkedHashSet<>();
            for (List<String> path : findPaths(roots, sinks)) result.addAll(path);
            expand(roots, outgoing, result, MAX_NEIGHBORHOOD_DEPTH);
            expand(sinks, incoming, result, MAX_NEIGHBORHOOD_DEPTH);
            result.addAll(roots);
            result.addAll(sinks);
            return result;
        }

        private void expand(
            List<String> starts,
            Map<String, LinkedHashSet<String>> graph,
            Set<String> result,
            int maxDepth
        ) {
            Deque<NodeDepth> queue = new ArrayDeque<>();
            Set<String> seen = new HashSet<>();
            for (String start : starts) queue.add(new NodeDepth(start, 0));
            while (!queue.isEmpty()) {
                NodeDepth current = queue.removeFirst();
                String key = current.method + "@" + current.depth;
                if (!seen.add(key)) continue;
                result.add(current.method);
                if (current.depth >= maxDepth) continue;
                Set<String> next = graph.get(current.method);
                if (next == null) continue;
                for (String method : next) queue.addLast(new NodeDepth(method, current.depth + 1));
            }
        }

        private String pathStatus(List<String> roots, List<String> sinks, List<List<String>> paths) {
            if (!paths.isEmpty()) return "PATHS_FOUND";
            if (!roots.isEmpty() && !sinks.isEmpty()) return "ROOTS_AND_SINKS_UNCONNECTED";
            if (!roots.isEmpty()) return "ROOTS_ONLY";
            if (!sinks.isEmpty()) return "SINKS_ONLY";
            return "NO_MATCH";
        }
    }

    private static final class NodeDepth {
        final String method;
        final int depth;

        NodeDepth(String method, int depth) {
            this.method = method;
            this.depth = depth;
        }
    }
}
