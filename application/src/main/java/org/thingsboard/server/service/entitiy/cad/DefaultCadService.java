/**
 * Copyright © 2016-2026 The Thingsboard Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.thingsboard.server.service.entitiy.cad;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.config.CadConfig;
import org.thingsboard.server.queue.util.TbCoreComponent;
import org.thingsboard.server.service.install.InstallScripts;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.LinkOption;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Slf4j
@Service
@TbCoreComponent
@RequiredArgsConstructor
class DefaultCadService implements CadService {

    private static final Pattern SVG_SCRIPT_PATTERN = Pattern.compile(
            "<script[\\s>]|on\\w+\\s*=|javascript\\s*:|<iframe[\\s>]|<object[\\s>]|<embed[\\s>]",
            Pattern.CASE_INSENSITIVE
    );

    private final CadConfig cadConfig;
    private final ObjectMapper objectMapper;
    private final InstallScripts installScripts;

    private String resolvedScriptPath;
    private CadResultCache resultCache;
    private final AtomicInteger activeConversions = new AtomicInteger();
    private final Map<TenantId, Boolean> activeTenants = new ConcurrentHashMap<>();

    @PostConstruct
    public void validateEnvironment() {
        if (cadConfig.getMaxFileSizeMb() <= 0 || cadConfig.getMaxEntities() <= 0 ||
                cadConfig.getMaxOutputSizeMb() <= 0 || cadConfig.getMaxConcurrentConversions() <= 0 ||
                cadConfig.getConversionTimeoutSeconds() <= 0) {
            throw new IllegalArgumentException("CAD conversion limits must be positive");
        }
        resultCache = new CadResultCache((long) cadConfig.getCacheSizeMb() * 1024 * 1024,
                TimeUnit.SECONDS.toNanos(cadConfig.getCacheTtlSeconds()));
        resolvedScriptPath = resolveScriptPath();
        if (!Files.exists(Path.of(resolvedScriptPath))) {
            log.warn("CAD Python script not found at: {}", resolvedScriptPath);
        } else {
            log.info("CAD Python script resolved to: {}", resolvedScriptPath);
        }
    }

    private String resolveScriptPath() {
        String configured = cadConfig.getScriptPath();
        if (configured != null && !configured.contains("${pkg.dirname}") && Files.exists(Path.of(configured))) {
            return configured;
        }
        return Paths.get(installScripts.getDataDir(), "scripts", "cad", "dwg_to_svg.py").toString();
    }

    @Override
    public CadConvertResult convertDwgToSvg(InputStream content, long size, String name, TenantId tenantId) {
        return (CadConvertResult) convert(content, size, name, tenantId, false);
    }

    @Override
    public CadPerEntityResult convertDwgToPerEntitySvg(InputStream content, long size, String name, TenantId tenantId) {
        return (CadPerEntityResult) convert(content, size, name, tenantId, true);
    }

    private Object convert(InputStream content, long size, String name, TenantId tenantId, boolean perEntity) {
        if (activeConversions.incrementAndGet() > cadConfig.getMaxConcurrentConversions()) {
            activeConversions.decrementAndGet();
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "CAD converter busy; retry after the active conversion finishes");
        }
        if (activeTenants.putIfAbsent(tenantId, Boolean.TRUE) != null) {
            activeConversions.decrementAndGet();
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "A CAD conversion is already running for this tenant");
        }
        long started = System.nanoTime();
        Path tempDir = null;
        try {
            tempDir = createTempDir(tenantId);
            Path inputFile = tempDir.resolve("input" + CadUploadIO.extension(name));
            String sourceHash = CadUploadIO.copy(content, size, name, inputFile,
                    (long) cadConfig.getMaxFileSizeMb() * 1024 * 1024);
            double uploadMs = elapsedMs(started);
            // Tenant, bytes, file format and all conversion limits are part of the
            // key. Cache only validated per-entity results, never user-supplied SVG.
            String cacheKey = tenantId.getId() + ":" + sourceHash + ":" + CadUploadIO.extension(name)
                    + ":" + cadConfig.getMaxEntities() + ":" + cadConfig.getMaxOutputSizeMb() + ":" + scriptRevision();
            byte[] cached = perEntity ? resultCache.get(cacheKey) : null;
            if (cached != null) {
                CadPerEntityResult result = objectMapper.readValue(cached, CadPerEntityResult.class);
                result.setCacheHit(true);
                result.setTimings(Map.of("uploadMs", uploadMs, "requestTotalMs", elapsedMs(started)));
                return result;
            }
            long converting = System.nanoTime();
            Path outputDir = Files.createDirectories(tempDir.resolve("output"));
            runPythonConversion(inputFile, outputDir, perEntity, sourceHash);
            checkOutputBudget(outputDir);
            double conversionMs = elapsedMs(converting);
            long reading = System.nanoTime();
            if (perEntity) {
                CadPerEntityResult result = readPerEntityResults(outputDir);
                result.setSceneId(sourceHash);
                Map<String, Double> timings = new java.util.LinkedHashMap<>(result.getTimings());
                timings.put("uploadMs", uploadMs);
                timings.put("pythonAndDwgMs", conversionMs);
                timings.put("readResultMs", elapsedMs(reading));
                timings.put("requestTotalMs", elapsedMs(started));
                result.setTimings(timings);
                long estimate = result.getManifest().stream()
                        .mapToLong(entity -> entity.getSvgBase64().length() + 1024L).sum();
                if (estimate > 0 && estimate <= resultCache.maxEntryBytes()) {
                    resultCache.put(cacheKey, objectMapper.writeValueAsBytes(result));
                }
                log.info("CAD conversion timings (ms), tenant {}: {}", tenantId, timings);
                return result;
            }
            return readConversionResults(outputDir);
        } catch (IOException e) {
            log.error("CAD conversion I/O error", e);
            throw new RuntimeException("CAD conversion failed: I/O error", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("CAD conversion interrupted", e);
        } finally {
            cleanupTempDir(tempDir);
            activeTenants.remove(tenantId);
            activeConversions.decrementAndGet();
        }
    }

    private static double elapsedMs(long start) {
        return (System.nanoTime() - start) / 1_000_000.0;
    }

    private String scriptRevision() throws IOException {
        // Invalidate results when any adjacent Python module changes in place.
        try (Stream<Path> paths = Files.list(Path.of(resolvedScriptPath).toAbsolutePath().getParent())) {
            StringBuilder revision = new StringBuilder();
            for (Path file : paths.filter(p -> p.toString().endsWith(".py")).sorted().toList()) {
                revision.append(file.getFileName()).append(':').append(Files.size(file))
                        .append(':').append(Files.getLastModifiedTime(file).toMillis()).append(';');
            }
            return revision.toString();
        }
    }

    private Path createTempDir(TenantId tenantId) throws IOException {
        Path baseDir = cadConfig.getTempDir() != null
                ? Path.of(cadConfig.getTempDir())
                : Path.of(System.getProperty("java.io.tmpdir"), "cad-convert");
        Path tenantDir = baseDir.resolve(tenantId.getId().toString());
        Files.createDirectories(tenantDir);
        return Files.createTempDirectory(tenantDir, "cad-convert-");
    }

    private void runPythonConversion(Path inputFile, Path outputDir, boolean perEntity, String sourceHash)
            throws IOException, InterruptedException {
        List<String> command = new ArrayList<>(List.of(cadConfig.getPythonPath(), resolvedScriptPath, inputFile.toString()));
        if (perEntity) command.addAll(List.of("--per-entity", "--max-entities", String.valueOf(cadConfig.getMaxEntities())));
        else command.add("--invert");
        command.addAll(List.of("-o", outputDir.toString()));
        Path stderr = outputDir.resolve("conversion.stderr");
        ProcessBuilder builder = new ProcessBuilder(command)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(stderr.toFile());
        builder.environment().put("TB_CAD_SOURCE_SHA256", sourceHash);
        if (perEntity) builder.environment().put("TB_CAD_WEB_BUNDLE", "1");
        builder.environment().put("TB_CAD_MAX_OUTPUT_BYTES", Long.toString((long) cadConfig.getMaxOutputSizeMb() * 1024 * 1024));
        Process process = builder.start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(cadConfig.getConversionTimeoutSeconds());
        try {
            while (!process.waitFor(1, TimeUnit.SECONDS)) {
                if (System.nanoTime() >= deadline) throw new RuntimeException("CAD conversion timed out");
                checkOutputBudget(outputDir);
            }
            if (process.exitValue() != 0) {
                log.warn("CAD converter exited {}: {}", process.exitValue(), readStderrFile(stderr));
                throw new RuntimeException("CAD conversion failed. Check file complexity, supported entities and converter configuration.");
            }
        } finally {
            // Includes ODA descendants, not just the Python parent. Snapshot the
            // descendants BEFORE killing the parent so they cannot become orphans.
            if (process.isAlive()) {
                var children = process.descendants().toList();
                children.forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                try { process.onExit().get(5, TimeUnit.SECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                catch (Exception e) { log.warn("CAD process did not exit promptly", e); }
            }
        }
    }

    private void checkOutputBudget(Path outputDir) throws IOException {
        long limit = (long) cadConfig.getMaxOutputSizeMb() * 1024 * 1024;
        long total = 0;
        try (Stream<Path> files = Files.walk(outputDir)) {
            var iterator = files.iterator();
            while (iterator.hasNext()) {
                Path path = iterator.next();
                if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    total += Files.size(path);
                    if (total > limit) throw new IllegalArgumentException("CAD output exceeds the configured resource limit");
                }
            }
        }
    }

    private String readStderrFile(Path file) {
        try (InputStream input = Files.newInputStream(file)) {
            return new String(input.readNBytes(16 * 1024), StandardCharsets.UTF_8);
        } catch (IOException e) { return ""; }
    }

    private CadConvertResult readConversionResults(Path outputDir) throws IOException {
        Path previewFile = outputDir.resolve("preview.svg");
        String previewBase64 = "";
        if (Files.exists(previewFile)) {
            previewBase64 = Base64.getEncoder().encodeToString(Files.readAllBytes(previewFile));
        }

        Path blocksDir = outputDir.resolve("blocks");
        List<CadBlockInfo> blocks = new ArrayList<>();
        if (Files.isDirectory(blocksDir)) {
            try (Stream<Path> paths = Files.list(blocksDir)) {
                paths.filter(p -> p.toString().endsWith(".svg"))
                        .sorted()
                        .forEach(svgFile -> {
                            try {
                                String svgContent = Files.readString(svgFile, StandardCharsets.UTF_8);
                                if (containsUnsafeContent(svgContent)) {
                                    log.warn("Skipping block with unsafe SVG content: {}", svgFile.getFileName());
                                    return;
                                }
                                String name = svgFile.getFileName().toString();
                                name = name.substring(0, name.length() - 4);
                                String svgBase64 = Base64.getEncoder().encodeToString(svgContent.getBytes(StandardCharsets.UTF_8));
                                blocks.add(new CadBlockInfo(name, svgBase64));
                            } catch (IOException e) {
                                log.warn("Failed to read block SVG: {}", svgFile, e);
                            }
                        });
            }
        }

        return new CadConvertResult(previewBase64, blocks);
    }

    private CadPerEntityResult readPerEntityResults(Path outputDir) throws IOException {
        Path manifestFile = outputDir.resolve("manifest.json");
        if (!Files.isRegularFile(manifestFile)) throw new IOException("CAD manifest is missing");
        var manifest = objectMapper.readTree(manifestFile.toFile());
        var entries = manifest.isArray() ? manifest : manifest.path("entities");
        if (!entries.isArray() || entries.size() > cadConfig.getMaxEntities()) {
            throw new IOException("Invalid CAD manifest or entity limit exceeded");
        }
        List<CadEntityInfo> entities = new ArrayList<>();
        var ids = new java.util.HashSet<String>();
        for (var entry : entries) {
            String id = entry.path("id").asText();
            if (id.isEmpty() || !ids.add(id)) throw new IOException("Duplicate or missing CAD instance identity");
            String svgContent;
            String svgBase64;
            if (entry.path("svgBase64").isTextual()) {
                svgBase64 = entry.path("svgBase64").asText();
                svgContent = CadInlineResource.decode(svgBase64);
            } else {
                Path svgPath = outputDir.resolve(entry.path("svgFile").asText()).normalize();
                if (!svgPath.startsWith(outputDir) || !Files.isRegularFile(svgPath, LinkOption.NOFOLLOW_LINKS) ||
                        !svgPath.toRealPath().startsWith(outputDir.toRealPath())) throw new IOException("Invalid CAD entity resource path");
                if (Files.size(svgPath) > 4 * 1024 * 1024) throw new IOException("A single CAD instance is too complex; split this block before import");
                svgContent = Files.readString(svgPath, StandardCharsets.UTF_8);
                svgBase64 = Base64.getEncoder().encodeToString(svgContent.getBytes(StandardCharsets.UTF_8));
            }
            if (containsUnsafeContent(svgContent)) throw new IOException("Unsafe CAD entity resource");
            var entity = new CadEntityInfo(id, entry.path("type").asText(),
                    svgBase64,
                    finite(entry, "x"), finite(entry, "y"), finite(entry, "width"), finite(entry, "height"),
                    entry.path("blockName").isNull() ? null : entry.path("blockName").asText(),
                    finite(entry, "previewX"), finite(entry, "previewY"),
                    finite(entry, "previewWidth"), finite(entry, "previewHeight"));
            if (entity.getPreviewWidth() <= 0 || entity.getPreviewHeight() <= 0) throw new IOException("Invalid CAD entity bounds");
            entity.setHandle(entry.path("handle").asText());
            entity.setLayer(entry.path("layer").asText());
            entities.add(entity);
        }
        CadPerEntityResult result = new CadPerEntityResult();
        result.setManifest(entities);
        Map<String, Double> timings = new java.util.LinkedHashMap<>();
        var fields = manifest.path("timings").fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if (field.getValue().isNumber() && Double.isFinite(field.getValue().doubleValue()) && field.getValue().doubleValue() >= 0) {
                timings.put(field.getKey(), field.getValue().doubleValue());
            }
        }
        result.setTimings(timings);
        result.setSchemaVersion(manifest.path("schemaVersion").asInt(1));
        result.setSourceEntityCount(manifest.path("sourceEntityCount").asInt(entities.size()));
        result.setUnrenderedEntityCount(manifest.path("unrenderedEntityCount").asInt());
        result.setSkippedPrimitiveCount(manifest.path("skippedCount").asInt());
        String background = manifest.path("backgroundColor").asText("#ffffff");
        if (!background.matches("#[0-9a-fA-F]{6}")) throw new IOException("Invalid CAD background color");
        result.setBackgroundColor(background);
        List<CadPerEntityResult.ConversionWarning> warnings = new ArrayList<>();
        for (var warning : manifest.path("warnings")) {
            if (warnings.size() >= 100) break;
            warnings.add(new CadPerEntityResult.ConversionWarning(
                    warning.path("handle").asText(), warning.path("type").asText(), warning.path("reason").asText()));
        }
        result.setWarnings(warnings);
        // v2 preview is reconstructed from the canonical entity resources. Avoid
        // transmitting a second copy of the complete drawing as base64 JSON.
        Path preview = outputDir.resolve("preview.svg");
        result.setPreviewSvgBase64(result.getSchemaVersion() >= 2 || !Files.exists(preview) ? "" :
                Base64.getEncoder().encodeToString(Files.readAllBytes(preview)));
        if (!entities.isEmpty()) {
            var bounds = manifest.path("modelspaceBounds");
            result.setModelspaceBounds(new CadPerEntityResult.ModelspaceBounds(
                    finite(bounds, "minX"), finite(bounds, "maxX"), finite(bounds, "minY"), finite(bounds, "maxY")));
            var box = manifest.path("previewViewBox");
            double width = finite(box, "width"), height = finite(box, "height");
            if (width <= 0 || height <= 0) throw new IOException("Invalid CAD scene frame");
            result.setPreviewTransform(new CadPerEntityResult.PreviewTransform(
                    finite(box, "x"), finite(box, "y"), width, height,
                    finite(manifest, "scale"), finite(manifest, "translateX"), finite(manifest, "translateY"),
                    manifest.path("yFlip").asBoolean(true)));
        }
        return result;
    }

    private double finite(com.fasterxml.jackson.databind.JsonNode node, String field) throws IOException {
        if (!node.path(field).isNumber() || !Double.isFinite(node.path(field).doubleValue())) {
            throw new IOException("Missing or non-finite CAD coordinate: " + field);
        }
        return node.path(field).doubleValue();
    }

    private boolean containsUnsafeContent(String svgContent) {
        return SVG_SCRIPT_PATTERN.matcher(svgContent).find();
    }

    private void cleanupTempDir(Path tempDir) {
        if (tempDir == null || !Files.exists(tempDir)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(tempDir)) {
            walk.sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException e) {
                            log.warn("Failed to delete temp file: {}", path, e);
                        }
                    });
        } catch (IOException e) {
            log.warn("Failed to cleanup temp directory: {}", tempDir, e);
        }
    }

}
