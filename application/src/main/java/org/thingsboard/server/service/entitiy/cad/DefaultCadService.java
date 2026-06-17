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

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.config.CadConfig;
import org.thingsboard.server.queue.util.TbCoreComponent;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
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

    private static final Pattern DWG_VERSION_PATTERN = Pattern.compile("AC10[0-9a-fA-F]{2}");
    private static final List<String> ALLOWED_EXTENSIONS = List.of(".dwg", ".dxf");

    private final CadConfig cadConfig;

    @Override
    public CadConvertResult convertDwgToSvg(byte[] fileContent, String originalFilename, TenantId tenantId) {
        validateFile(fileContent, originalFilename);

        Path tempDir = null;
        try {
            tempDir = createTempDir(tenantId);
            Path inputFile = tempDir.resolve(sanitizeFilename(originalFilename));
            Files.write(inputFile, fileContent);

            Path outputDir = tempDir.resolve("output");
            Files.createDirectories(outputDir);

            runPythonConversion(inputFile, outputDir);

            return readConversionResults(outputDir);
        } catch (IOException e) {
            log.error("CAD conversion I/O error", e);
            throw new RuntimeException("CAD conversion failed: I/O error");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("CAD conversion interrupted");
        } finally {
            cleanupTempDir(tempDir);
        }
    }

    private void validateFile(byte[] fileContent, String originalFilename) {
        if (originalFilename == null || originalFilename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        String lowerName = originalFilename.toLowerCase();
        boolean hasValidExtension = ALLOWED_EXTENSIONS.stream().anyMatch(lowerName::endsWith);
        if (!hasValidExtension) {
            throw new IllegalArgumentException("Unsupported file format. Only .dwg and .dxf files are accepted.");
        }

        if (fileContent == null || fileContent.length == 0) {
            throw new IllegalArgumentException("File is empty");
        }

        int maxSizeBytes = cadConfig.getMaxFileSizeMb() * 1024 * 1024;
        if (fileContent.length > maxSizeBytes) {
            throw new IllegalArgumentException("File exceeds maximum size of " + cadConfig.getMaxFileSizeMb() + "MB");
        }

        if (lowerName.endsWith(".dwg")) {
            validateDwgMagicBytes(fileContent);
        } else {
            validateDxfMagicBytes(fileContent);
        }
    }

    private void validateDwgMagicBytes(byte[] content) {
        if (content.length < 6) {
            throw new IllegalArgumentException("File too small to be a valid DWG file");
        }
        String header = new String(content, 0, Math.min(content.length, 32), StandardCharsets.US_ASCII);
        if (!DWG_VERSION_PATTERN.matcher(header).find()) {
            throw new IllegalArgumentException("Not a valid DWG file: missing version signature");
        }
    }

    private void validateDxfMagicBytes(byte[] content) {
        String header = new String(content, 0, Math.min(content.length, 256), StandardCharsets.US_ASCII);
        String firstLine = header.lines().findFirst().orElse("").trim();
        if (!"0".equals(firstLine)) {
            throw new IllegalArgumentException("Not a valid DXF file: missing section marker");
        }
        if (!header.contains("SECTION")) {
            throw new IllegalArgumentException("Not a valid DXF file: missing SECTION declaration");
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

    private void runPythonConversion(Path inputFile, Path outputDir) throws IOException, InterruptedException {
        List<String> command = List.of(
                cadConfig.getPythonPath(),
                cadConfig.getScriptPath(),
                inputFile.toString(),
                "--invert",
                "-o", outputDir.toString()
        );

        log.debug("Running CAD conversion: {}", String.join(" ", command));

        Path stderrFile = outputDir.resolve("conversion.stderr");
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(false);
        pb.redirectOutput(ProcessBuilder.Redirect.DISCARD);
        pb.redirectError(stderrFile.toFile());

        int timeout = cadConfig.getConversionTimeoutSeconds();
        Process process = pb.start();

        boolean finished = process.waitFor(timeout, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            log.error("CAD conversion timed out after {} seconds", timeout);
            throw new RuntimeException("CAD conversion timed out after " + timeout + " seconds");
        }

        String stderr = readStderrFile(stderrFile);
        if (process.exitValue() != 0) {
            log.error("Python conversion failed with exit code {}: {}", process.exitValue(), stderr);
            throw new RuntimeException("CAD conversion failed");
        }
    }

    private String readStderrFile(Path stderrFile) {
        if (!Files.exists(stderrFile)) {
            return "";
        }
        try {
            return Files.readString(stderrFile, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("Failed to read conversion stderr file: {}", stderrFile, e);
            return "";
        }
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

    private boolean containsUnsafeContent(String svgContent) {
        return SVG_SCRIPT_PATTERN.matcher(svgContent).find();
    }

    private String sanitizeFilename(String filename) {
        String sanitized = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (sanitized.isEmpty() || sanitized.equals(".")) {
            return "cad-file";
        }
        return sanitized;
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
