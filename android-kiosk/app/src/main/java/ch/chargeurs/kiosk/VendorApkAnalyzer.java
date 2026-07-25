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
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.Enumeration;
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
 * Passive, bounded DEX inventory and call-graph extraction.
 * Never executes vendor code, opens serial I/O, or writes to the PCB.
 */
public final class VendorApkAnalyzer {
    private static final int MAX_ENTRIES = 8_000;
    private static final int MAX_DEX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_STRINGS = 1_200;
    private static final int MAX_CLASSES = 800;
    private static final int MAX_METHODS = 1_200;
    private static final int MAX_FIELDS = 800;
    private static final int MAX_NATIVE_BINARIES = 250;
    private static final int MAX_CALL_SITES = 4_000;
    private static final int MAX_CALL_GRAPH_EDGES = 12_000;
    private static final int MAX_CALL_CHAINS = 80;
    private static final int MAX_CHAIN_DEPTH = 10;
    private static final int MAX_METHOD_LITERALS = 24;
    private static final int MAX_TEXT = 320;

    private static final String VENDOR_PREFIX = "Lcom/szbjkj/bajietouchpower/";
    private static final String SERIAL_PREFIX = "Lcom/fazecast/jSerialComm/";

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

    private static final Set<String> SERIAL_METHOD_NAMES = new HashSet<>(Arrays.asList(
        "getCommPort", "openPort", "closePort", "writeBytes", "readBytes",
        "bytesAvailable", "setComPortParameters", "setBaudRate", "setNumDataBits",
        "setNumStopBits", "setParity", "setComPortTimeouts", "addDataListener"
    ));

    private VendorApkAnalyzer() {}

    public static JSONObject analyze(Context context, String packageName) {
        return analyze(context, packageName, Collections.emptyList());
    }

    public static JSONObject analyze(Context context, String packageName, List<String> customTerms) {
        JSONObject result = new JSONObject();
        List<String> terms = mergeTerms(customTerms);
        put(result, "schemaVersion", 3);
        put(result, "profile", "DTA21269_DEX_CALLGRAPH");
        put(result, "package", packageName);
        put(result, "generatedAt", System.currentTimeMillis());
        put(result, "profileTerms", new JSONArray(terms));
        put(result, "safeReadOnly", true);
        put(result, "vendorApkCopied", false);
        put(result, "vendorCodeExecuted", false);
        put(result, "serialPortOpened", false);
        put(result, "serialBytesWritten", 0);
        put(result, "credentialsCollected", false);
        put(result, "protocolSolved", false);
        put(result, "limitations", new JSONArray(Arrays.asList(
            "STATIC_ANALYSIS_ONLY",
            "NO_VENDOR_CODE_EXECUTION",
            "NO_SERIAL_IO",
            "DYNAMIC_DISPATCH_MAY_HIDE_EDGES",
            "METHOD_LITERALS_ARE_CONTEXT_NOT_ARGUMENT_PROOF"
        )));

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
        JSONArray candidateCallSites = new JSONArray();

        Set<String> stringKeys = new LinkedHashSet<>();
        Set<String> classKeys = new LinkedHashSet<>();
        Set<String> methodKeys = new LinkedHashSet<>();
        Set<String> fieldKeys = new LinkedHashSet<>();
        Set<String> callSiteKeys = new LinkedHashSet<>();
        Set<String> graphKeys = new LinkedHashSet<>();
        Set<String> startMethods = new LinkedHashSet<>();
        Set<String> serialSinks = new LinkedHashSet<>();
        List<CallEdge> graphEdges = new ArrayList<>();

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
                    candidateCallSites,
                    graphEdges,
                    stringKeys,
                    classKeys,
                    methodKeys,
                    fieldKeys,
                    callSiteKeys,
                    graphKeys,
                    startMethods,
                    serialSinks
                );
                dexFiles.put(dex);
                if (relevantStrings.length() >= MAX_STRINGS
                    || candidateMethods.length() >= MAX_METHODS
                    || candidateFields.length() >= MAX_FIELDS
                    || candidateCallSites.length() >= MAX_CALL_SITES
                    || graphEdges.size() >= MAX_CALL_GRAPH_EDGES) {
                    truncated = true;
                }
            }
        }

        JSONArray callGraph = new JSONArray();
        for (CallEdge edge : graphEdges) callGraph.put(edge.toGraphJson());
        JSONArray callChains = buildCallChains(graphEdges, startMethods, serialSinks);

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
        put(archive, "candidateCallSites", candidateCallSites);
        put(archive, "vendorCallGraphEdges", callGraph);
        put(archive, "candidateCallChains", callChains);
        put(archive, "relevantStringCount", relevantStrings.length());
        put(archive, "candidateClassCount", candidateClasses.length());
        put(archive, "candidateMethodCount", candidateMethods.length());
        put(archive, "candidateFieldCount", candidateFields.length());
        put(archive, "candidateCallSiteCount", candidateCallSites.length());
        put(archive, "vendorCallGraphEdgeCount", graphEdges.size());
        put(archive, "candidateCallChainCount", callChains.length());
        put(archive, "callChainStatus", callChains.length() > 0 ? "STATIC_PATH_FOUND" : "NO_STATIC_PATH_FOUND");
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
        JSONArray candidateCallSites,
        List<CallEdge> graphEdges,
        Set<String> stringKeys,
        Set<String> classKeys,
        Set<String> methodKeys,
        Set<String> fieldKeys,
        Set<String> callSiteKeys,
        Set<String> graphKeys,
        Set<String> startMethods,
        Set<String> serialSinks
    ) {
        JSONObject result = new JSONObject();
        put(result, "name", entryName);
        put(result, "size", data.length);
        int vendorClassesScanned = 0;
        int vendorMethodsScanned = 0;
        int invokeInstructionsScanned = 0;
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
            int classCount = u32(data, 0x60);
            int classOffset = u32(data, 0x64);

            checkTable(data, stringOffset, stringCount, 4);
            checkTable(data, typeOffset, typeCount, 4);
            checkTable(data, protoOffset, protoCount, 12);
            checkTable(data, fieldOffset, fieldCount, 8);
            checkTable(data, methodOffset, methodCount, 8);
            checkTable(data, classOffset, classCount, 32);

            List<String> strings = new ArrayList<>(stringCount);
            for (int index = 0; index < stringCount; index++) {
                int valueOffset = u32(data, stringOffset + index * 4);
                strings.add(readDexString(data, valueOffset));
            }

            int[] typeStringIndexes = new int[typeCount];
            for (int index = 0; index < typeCount; index++) {
                typeStringIndexes[index] = u32(data, typeOffset + index * 4);
            }

            MethodRef[] methods = new MethodRef[methodCount];
            for (int index = 0; index < methodCount; index++) {
                int offset = methodOffset + index * 8;
                int classIndex = u16(data, offset);
                int protoIndex = u16(data, offset + 2);
                int nameIndex = u32(data, offset + 4);
                String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
                String name = stringAt(strings, nameIndex);
                String proto = protoSignature(data, strings, typeStringIndexes, protoOffset, protoCount, protoIndex);
                methods[index] = new MethodRef(owner, name, proto);
                if (isStartMethod(methods[index].signature)) startMethods.add(methods[index].signature);
                if (isSerialSink(methods[index])) serialSinks.add(methods[index].signature);
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

            for (MethodRef method : methods) {
                if (candidateMethods.length() >= MAX_METHODS) break;
                if (!isCandidateMember(method.owner, method.name, terms)) continue;
                if (!methodKeys.add(entryName + "|" + method.signature)) continue;
                JSONObject item = new JSONObject();
                put(item, "dex", entryName);
                put(item, "owner", redact(method.owner));
                put(item, "name", redact(method.name));
                put(item, "prototype", redact(method.prototype));
                put(item, "signature", redact(method.signature));
                put(item, "priority", methodPriority(method.owner, method.name));
                candidateMethods.put(item);
            }

            for (int index = 0; index < classCount; index++) {
                int offset = classOffset + index * 32;
                int classIndex = u32(data, offset);
                int classDataOffset = u32(data, offset + 24);
                String owner = typeDescriptor(strings, typeStringIndexes, classIndex);
                if (!isVendorOwner(owner) || classDataOffset == 0) continue;
                vendorClassesScanned++;
                ClassScanStats stats = parseClassData(
                    entryName,
                    data,
                    classDataOffset,
                    methods,
                    strings,
                    terms,
                    candidateCallSites,
                    graphEdges,
                    callSiteKeys,
                    graphKeys
                );
                vendorMethodsScanned += stats.methodsScanned;
                invokeInstructionsScanned += stats.invokesScanned;
            }

            put(result, "status", "PARSED");
            put(result, "stringCount", stringCount);
            put(result, "typeCount", typeCount);
            put(result, "protoCount", protoCount);
            put(result, "fieldCount", fieldCount);
            put(result, "methodCount", methodCount);
            put(result, "classCount", classCount);
            put(result, "vendorClassesScanned", vendorClassesScanned);
            put(result, "vendorMethodsScanned", vendorMethodsScanned);
            put(result, "invokeInstructionsScanned", invokeInstructionsScanned);
        } catch (Exception error) {
            put(result, "status", "PARSE_FAILED");
            put(result, "error", error.getClass().getSimpleName());
            put(result, "errorMessage", redact(String.valueOf(error.getMessage())));
        }
        return result;
    }

    private static ClassScanStats parseClassData(
        String dexName,
        byte[] data,
        int classDataOffset,
        MethodRef[] methods,
        List<String> strings,
        List<String> terms,
        JSONArray candidateCallSites,
        List<CallEdge> graphEdges,
        Set<String> callSiteKeys,
        Set<String> graphKeys
    ) {
        int position = classDataOffset;
        Uleb staticFields = readUleb(data, position);
        position = staticFields.next;
        Uleb instanceFields = readUleb(data, position);
        position = instanceFields.next;
        Uleb directMethods = readUleb(data, position);
        position = directMethods.next;
        Uleb virtualMethods = readUleb(data, position);
        position = virtualMethods.next;

        position = skipEncodedFields(data, position, staticFields.value);
        position = skipEncodedFields(data, position, instanceFields.value);

        ClassScanStats total = new ClassScanStats();
        MethodListResult direct = scanEncodedMethods(
            dexName,
            data,
            position,
            directMethods.value,
            methods,
            strings,
            terms,
            candidateCallSites,
            graphEdges,
            callSiteKeys,
            graphKeys
        );
        position = direct.next;
        total.add(direct.stats);

        MethodListResult virtual = scanEncodedMethods(
            dexName,
            data,
            position,
            virtualMethods.value,
            methods,
            strings,
            terms,
            candidateCallSites,
            graphEdges,
            callSiteKeys,
            graphKeys
        );
        total.add(virtual.stats);
        return total;
    }

    private static int skipEncodedFields(byte[] data, int position, int count) {
        for (int index = 0; index < count; index++) {
            Uleb fieldIndexDiff = readUleb(data, position);
            position = fieldIndexDiff.next;
            Uleb accessFlags = readUleb(data, position);
            position = accessFlags.next;
        }
        return position;
    }

    private static MethodListResult scanEncodedMethods(
        String dexName,
        byte[] data,
        int position,
        int count,
        MethodRef[] methods,
        List<String> strings,
        List<String> terms,
        JSONArray candidateCallSites,
        List<CallEdge> graphEdges,
        Set<String> callSiteKeys,
        Set<String> graphKeys
    ) {
        int methodIndex = 0;
        ClassScanStats stats = new ClassScanStats();
        for (int index = 0; index < count; index++) {
            Uleb methodIndexDiff = readUleb(data, position);
            position = methodIndexDiff.next;
            methodIndex += methodIndexDiff.value;
            Uleb accessFlags = readUleb(data, position);
            position = accessFlags.next;
            Uleb codeOffset = readUleb(data, position);
            position = codeOffset.next;

            if (methodIndex < 0 || methodIndex >= methods.length) continue;
            if (codeOffset.value == 0) continue;
            MethodScanStats methodStats = scanMethodCode(
                dexName,
                data,
                codeOffset.value,
                methods[methodIndex],
                methods,
                strings,
                terms,
                candidateCallSites,
                graphEdges,
                callSiteKeys,
                graphKeys
            );
            stats.methodsScanned++;
            stats.invokesScanned += methodStats.invokesScanned;
        }
        return new MethodListResult(position, stats);
    }

    private static MethodScanStats scanMethodCode(
        String dexName,
        byte[] data,
        int codeOffset,
        MethodRef caller,
        MethodRef[] methods,
        List<String> strings,
        List<String> terms,
        JSONArray candidateCallSites,
        List<CallEdge> graphEdges,
        Set<String> callSiteKeys,
        Set<String> graphKeys
    ) {
        MethodScanStats stats = new MethodScanStats();
        if (codeOffset < 0 || codeOffset + 16 > data.length) return stats;
        int insnsSize = u32(data, codeOffset + 12);
        int insnsOffset = codeOffset + 16;
        if (insnsSize < 0 || insnsOffset + insnsSize * 2L > data.length) return stats;

        List<String> methodStrings = new ArrayList<>();
        List<Long> methodNumbers = new ArrayList<>();
        List<PendingInvoke> invokes = new ArrayList<>();

        int pc = 0;
        while (pc < insnsSize) {
            int unit = codeUnit(data, insnsOffset, pc);
            int opcode = unit & 0xff;
            int width = instructionWidth(data, insnsOffset, pc, insnsSize);
            if (width <= 0 || pc + width > insnsSize) width = 1;

            if (opcode == 0x1a && pc + 1 < insnsSize) {
                int stringIndex = codeUnit(data, insnsOffset, pc + 1);
                addInterestingString(methodStrings, stringAt(strings, stringIndex), terms);
            } else if (opcode == 0x1b && pc + 2 < insnsSize) {
                long stringIndex = codeUnit(data, insnsOffset, pc + 1)
                    | ((long) codeUnit(data, insnsOffset, pc + 2) << 16);
                if (stringIndex <= Integer.MAX_VALUE) {
                    addInterestingString(methodStrings, stringAt(strings, (int) stringIndex), terms);
                }
            } else {
                Long constant = numericConstant(data, insnsOffset, pc, insnsSize, opcode, unit);
                if (constant != null && isInterestingNumber(constant)) addUnique(methodNumbers, constant);
            }

            if (isInvokeOpcode(opcode) && pc + 1 < insnsSize) {
                int methodIndex = codeUnit(data, insnsOffset, pc + 1);
                if (methodIndex >= 0 && methodIndex < methods.length) {
                    invokes.add(new PendingInvoke(opcode, pc, methods[methodIndex]));
                    stats.invokesScanned++;
                }
            }

            pc += width;
        }

        for (PendingInvoke invoke : invokes) {
            MethodRef callee = invoke.callee;
            if (!isVendorOwner(caller.owner)) continue;

            boolean graphEdge = isVendorOwner(callee.owner) || isSerialOwner(callee.owner);
            if (graphEdge && graphEdges.size() < MAX_CALL_GRAPH_EDGES) {
                String graphKey = dexName + "|" + caller.signature + "|" + callee.signature + "|" + invoke.codeUnitOffset;
                if (graphKeys.add(graphKey)) {
                    graphEdges.add(new CallEdge(
                        dexName,
                        caller.signature,
                        callee.signature,
                        opcodeName(invoke.opcode),
                        invoke.codeUnitOffset,
                        callPriority(caller, callee)
                    ));
                }
            }

            if (!isTargetCall(caller, callee, terms) || candidateCallSites.length() >= MAX_CALL_SITES) continue;
            String callSiteKey = dexName + "|" + caller.signature + "|" + callee.signature + "|" + invoke.codeUnitOffset;
            if (!callSiteKeys.add(callSiteKey)) continue;

            JSONObject item = new JSONObject();
            put(item, "dex", dexName);
            put(item, "caller", redact(caller.signature));
            put(item, "callee", redact(callee.signature));
            put(item, "opcode", opcodeName(invoke.opcode));
            put(item, "codeUnitOffset", invoke.codeUnitOffset);
            put(item, "codeByteOffset", invoke.codeUnitOffset * 2L);
            put(item, "priority", callPriority(caller, callee));
            put(item, "methodStringLiterals", new JSONArray(methodStrings));
            put(item, "methodNumericLiterals", new JSONArray(methodNumbers));
            put(item, "literalScope", "CALLER_METHOD");
            candidateCallSites.put(item);
        }
        return stats;
    }

    private static JSONArray buildCallChains(
        List<CallEdge> edges,
        Set<String> startMethods,
        Set<String> serialSinks
    ) {
        JSONArray result = new JSONArray();
        Map<String, List<CallEdge>> outgoing = new LinkedHashMap<>();
        for (CallEdge edge : edges) {
            outgoing.computeIfAbsent(edge.caller, ignored -> new ArrayList<>()).add(edge);
        }

        Set<String> chainKeys = new LinkedHashSet<>();
        int startsVisited = 0;
        for (String start : startMethods) {
            if (result.length() >= MAX_CALL_CHAINS || startsVisited++ >= 120) break;
            Deque<List<String>> queue = new ArrayDeque<>();
            queue.add(Collections.singletonList(start));
            Map<String, Integer> bestDepth = new HashMap<>();
            bestDepth.put(start, 0);

            while (!queue.isEmpty() && result.length() < MAX_CALL_CHAINS) {
                List<String> path = queue.removeFirst();
                String current = path.get(path.size() - 1);
                int depth = path.size() - 1;
                if (depth >= MAX_CHAIN_DEPTH) continue;

                List<CallEdge> nextEdges = outgoing.get(current);
                if (nextEdges == null) continue;
                for (CallEdge edge : nextEdges) {
                    String next = edge.callee;
                    if (path.contains(next)) continue;
                    List<String> nextPath = new ArrayList<>(path);
                    nextPath.add(next);

                    if (serialSinks.contains(next) || isSerialSignature(next)) {
                        String key = String.join("->", nextPath);
                        if (chainKeys.add(key)) {
                            JSONObject item = new JSONObject();
                            put(item, "start", redact(start));
                            put(item, "sink", redact(next));
                            put(item, "depth", nextPath.size() - 1);
                            put(item, "methods", new JSONArray(nextPath));
                            put(item, "staticOnly", true);
                            result.put(item);
                        }
                        continue;
                    }

                    if (!isVendorSignature(next)) continue;
                    int nextDepth = depth + 1;
                    Integer previous = bestDepth.get(next);
                    if (previous != null && previous <= nextDepth) continue;
                    bestDepth.put(next, nextDepth);
                    queue.addLast(nextPath);
                }
            }
        }
        return result;
    }

    private static Long numericConstant(
        byte[] data,
        int insnsOffset,
        int pc,
        int insnsSize,
        int opcode,
        int firstUnit
    ) {
        if (opcode == 0x12) {
            return (long) signExtend((firstUnit >>> 12) & 0x0f, 4);
        }
        if ((opcode == 0x13 || opcode == 0x16) && pc + 1 < insnsSize) {
            return (long) (short) codeUnit(data, insnsOffset, pc + 1);
        }
        if ((opcode == 0x14 || opcode == 0x17) && pc + 2 < insnsSize) {
            return (long) signed32(
                codeUnit(data, insnsOffset, pc + 1),
                codeUnit(data, insnsOffset, pc + 2)
            );
        }
        if (opcode == 0x15 && pc + 1 < insnsSize) {
            return ((long) (short) codeUnit(data, insnsOffset, pc + 1)) << 16;
        }
        if (opcode == 0x18 && pc + 4 < insnsSize) {
            return signed64(
                codeUnit(data, insnsOffset, pc + 1),
                codeUnit(data, insnsOffset, pc + 2),
                codeUnit(data, insnsOffset, pc + 3),
                codeUnit(data, insnsOffset, pc + 4)
            );
        }
        if (opcode == 0x19 && pc + 1 < insnsSize) {
            return ((long) (short) codeUnit(data, insnsOffset, pc + 1)) << 48;
        }
        return null;
    }

    private static int instructionWidth(byte[] data, int insnsOffset, int pc, int insnsSize) {
        int unit = codeUnit(data, insnsOffset, pc);
        int opcode = unit & 0xff;
        if (opcode == 0x00) {
            if (unit == 0x0100 && pc + 1 < insnsSize) {
                int size = codeUnit(data, insnsOffset, pc + 1);
                return safeWidth(4L + size * 2L);
            }
            if (unit == 0x0200 && pc + 1 < insnsSize) {
                int size = codeUnit(data, insnsOffset, pc + 1);
                return safeWidth(2L + size * 4L);
            }
            if (unit == 0x0300 && pc + 3 < insnsSize) {
                int elementWidth = codeUnit(data, insnsOffset, pc + 1);
                long size = codeUnit(data, insnsOffset, pc + 2)
                    | ((long) codeUnit(data, insnsOffset, pc + 3) << 16);
                long dataUnits = (elementWidth * size + 1L) / 2L;
                return safeWidth(4L + dataUnits);
            }
            return 1;
        }

        if (opcode == 0x18) return 5;
        if (opcode == 0xfa || opcode == 0xfb) return 4;

        if (opcode == 0x03 || opcode == 0x06 || opcode == 0x09
            || opcode == 0x14 || opcode == 0x17 || opcode == 0x1b
            || (opcode >= 0x24 && opcode <= 0x26)
            || (opcode >= 0x2a && opcode <= 0x2c)
            || (opcode >= 0x6e && opcode <= 0x72)
            || (opcode >= 0x74 && opcode <= 0x78)
            || opcode == 0xfc || opcode == 0xfd) {
            return 3;
        }

        if (opcode == 0x02 || opcode == 0x05 || opcode == 0x08
            || opcode == 0x13 || opcode == 0x15 || opcode == 0x16 || opcode == 0x19
            || opcode == 0x1a || opcode == 0x1c || opcode == 0x1f || opcode == 0x20
            || opcode == 0x22 || opcode == 0x23 || opcode == 0x29
            || (opcode >= 0x2d && opcode <= 0x3d)
            || (opcode >= 0x44 && opcode <= 0x6d)
            || (opcode >= 0x90 && opcode <= 0xaf)
            || (opcode >= 0xd0 && opcode <= 0xe2)
            || opcode == 0xfe || opcode == 0xff) {
            return 2;
        }
        return 1;
    }

    private static boolean isInvokeOpcode(int opcode) {
        return (opcode >= 0x6e && opcode <= 0x72)
            || (opcode >= 0x74 && opcode <= 0x78)
            || opcode == 0xfa || opcode == 0xfb;
    }

    private static String opcodeName(int opcode) {
        switch (opcode) {
            case 0x6e: return "invoke-virtual";
            case 0x6f: return "invoke-super";
            case 0x70: return "invoke-direct";
            case 0x71: return "invoke-static";
            case 0x72: return "invoke-interface";
            case 0x74: return "invoke-virtual/range";
            case 0x75: return "invoke-super/range";
            case 0x76: return "invoke-direct/range";
            case 0x77: return "invoke-static/range";
            case 0x78: return "invoke-interface/range";
            case 0xfa: return "invoke-polymorphic";
            case 0xfb: return "invoke-polymorphic/range";
            default: return String.format(Locale.US, "invoke-0x%02x", opcode);
        }
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
        return lower.startsWith(VENDOR_PREFIX.toLowerCase(Locale.US))
            || lower.startsWith(SERIAL_PREFIX.toLowerCase(Locale.US))
            || lower.contains("paymentendactivity")
            || lower.contains("batteryrental")
            || matchesAny(lower, terms);
    }

    private static boolean isCandidateMember(String owner, String name, List<String> terms) {
        String combined = owner + " " + name;
        String lowerOwner = owner.toLowerCase(Locale.US);
        boolean vendor = lowerOwner.startsWith(VENDOR_PREFIX.toLowerCase(Locale.US));
        boolean serialLibrary = lowerOwner.startsWith(SERIAL_PREFIX.toLowerCase(Locale.US));
        return serialLibrary || matchesAny(combined, terms)
            || (vendor && matchesAny(name, Arrays.asList(
                "init", "rent", "take", "return", "out", "open", "write", "read",
                "send", "serial", "port", "battery", "slot", "eject", "cabinet", "crc"
            )));
    }

    private static boolean isTargetCall(MethodRef caller, MethodRef callee, List<String> terms) {
        if (isSerialOwner(callee.owner)) return true;
        if (isStartMethod(caller.signature) || isStartMethod(callee.signature)) return true;
        return matchesAny(caller.signature + " " + callee.signature, terms);
    }

    private static String callPriority(MethodRef caller, MethodRef callee) {
        if (isSerialSink(callee) || isStartMethod(caller.signature) || isStartMethod(callee.signature)) {
            return "HIGH";
        }
        if (isSerialOwner(callee.owner)) return "HIGH";
        return "MEDIUM";
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

    private static boolean isStartMethod(String signature) {
        String lower = signature.toLowerCase(Locale.US);
        return lower.contains("paymentendactivity") || lower.contains("initbatteryrental");
    }

    private static boolean isSerialSink(MethodRef method) {
        return isSerialOwner(method.owner) && SERIAL_METHOD_NAMES.contains(method.name);
    }

    private static boolean isSerialSignature(String signature) {
        String lower = signature.toLowerCase(Locale.US);
        if (!lower.startsWith(SERIAL_PREFIX.toLowerCase(Locale.US))) return false;
        for (String method : SERIAL_METHOD_NAMES) {
            if (lower.contains("->" + method.toLowerCase(Locale.US) + "(")) return true;
        }
        return false;
    }

    private static boolean isVendorSignature(String signature) {
        return signature.toLowerCase(Locale.US).startsWith(VENDOR_PREFIX.toLowerCase(Locale.US));
    }

    private static boolean isVendorOwner(String owner) {
        return owner.toLowerCase(Locale.US).startsWith(VENDOR_PREFIX.toLowerCase(Locale.US));
    }

    private static boolean isSerialOwner(String owner) {
        return owner.toLowerCase(Locale.US).startsWith(SERIAL_PREFIX.toLowerCase(Locale.US));
    }

    private static void addInterestingString(List<String> target, String value, List<String> terms) {
        if (value == null || target.size() >= MAX_METHOD_LITERALS) return;
        String lower = value.toLowerCase(Locale.US);
        boolean interesting = matchesAny(value, terms)
            || lower.contains("/dev/")
            || lower.contains("tty")
            || lower.contains("serial")
            || lower.contains("baud")
            || lower.contains("crc")
            || lower.startsWith("at+")
            || looksLikeHexFrame(value);
        if (!interesting) return;
        addUnique(target, redact(value));
    }

    private static boolean looksLikeHexFrame(String value) {
        String compact = value.replaceAll("[\\s,:;\\-]", "");
        return compact.length() >= 8
            && compact.length() <= 160
            && (compact.length() % 2 == 0)
            && compact.matches("(?i)[0-9a-f]+");
    }

    private static boolean isInterestingNumber(long value) {
        long absolute = Math.abs(value);
        return absolute == 0 || absolute == 1 || absolute == 2
            || absolute == 5 || absolute == 6 || absolute == 7 || absolute == 8
            || absolute == 9_600 || absolute == 19_200 || absolute == 38_400
            || absolute == 57_600 || absolute == 115_200;
    }

    private static <T> void addUnique(List<T> values, T value) {
        if (values.size() >= MAX_METHOD_LITERALS || values.contains(value)) return;
        values.add(value);
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

    private static Uleb readUleb(byte[] data, int offset) {
        if (offset < 0 || offset >= data.length) throw new IllegalArgumentException("DEX_ULEB_RANGE");
        int result = 0;
        int shift = 0;
        int position = offset;
        for (int index = 0; index < 5; index++) {
            if (position >= data.length) throw new IllegalArgumentException("DEX_ULEB_EOF");
            int value = data[position++] & 0xff;
            result |= (value & 0x7f) << shift;
            if ((value & 0x80) == 0) return new Uleb(result, position);
            shift += 7;
        }
        throw new IllegalArgumentException("DEX_ULEB_TOO_LONG");
    }

    private static int codeUnit(byte[] data, int insnsOffset, int index) {
        return u16(data, insnsOffset + index * 2);
    }

    private static int safeWidth(long value) {
        if (value <= 0 || value > Integer.MAX_VALUE) return 1;
        return (int) value;
    }

    private static int signExtend(int value, int bits) {
        int shift = 32 - bits;
        return (value << shift) >> shift;
    }

    private static int signed32(int low, int high) {
        return low | (high << 16);
    }

    private static long signed64(int unit0, int unit1, int unit2, int unit3) {
        return (unit0 & 0xffffL)
            | ((unit1 & 0xffffL) << 16)
            | ((unit2 & 0xffffL) << 32)
            | ((long) (short) unit3 << 48);
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
        String value = source.replaceAll(
            "(?i)(authorization|password|passwd|secret|token|apikey|api_key)\\s*[:=]\\s*[^\\s,;]+",
            "$1=[REDACTED]"
        );
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

    private static final class PendingInvoke {
        final int opcode;
        final int codeUnitOffset;
        final MethodRef callee;

        PendingInvoke(int opcode, int codeUnitOffset, MethodRef callee) {
            this.opcode = opcode;
            this.codeUnitOffset = codeUnitOffset;
            this.callee = callee;
        }
    }

    private static final class CallEdge {
        final String dex;
        final String caller;
        final String callee;
        final String opcode;
        final int codeUnitOffset;
        final String priority;

        CallEdge(
            String dex,
            String caller,
            String callee,
            String opcode,
            int codeUnitOffset,
            String priority
        ) {
            this.dex = dex;
            this.caller = caller;
            this.callee = callee;
            this.opcode = opcode;
            this.codeUnitOffset = codeUnitOffset;
            this.priority = priority;
        }

        JSONObject toGraphJson() {
            JSONObject item = new JSONObject();
            put(item, "dex", dex);
            put(item, "caller", redact(caller));
            put(item, "callee", redact(callee));
            put(item, "opcode", opcode);
            put(item, "codeUnitOffset", codeUnitOffset);
            put(item, "priority", priority);
            return item;
        }
    }

    private static final class Uleb {
        final int value;
        final int next;

        Uleb(int value, int next) {
            this.value = value;
            this.next = next;
        }
    }

    private static final class MethodScanStats {
        int invokesScanned;
    }

    private static final class ClassScanStats {
        int methodsScanned;
        int invokesScanned;

        void add(ClassScanStats other) {
            methodsScanned += other.methodsScanned;
            invokesScanned += other.invokesScanned;
        }
    }

    private static final class MethodListResult {
        final int next;
        final ClassScanStats stats;

        MethodListResult(int next, ClassScanStats stats) {
            this.next = next;
            this.stats = stats;
        }
    }
}
