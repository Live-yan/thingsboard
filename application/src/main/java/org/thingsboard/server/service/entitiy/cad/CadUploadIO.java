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

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

/** Bounded-memory upload staging. No upload-sized byte array is ever allocated. */
public final class CadUploadIO {
    private CadUploadIO() { }

    public static String extension(String name) {
        if (name == null) throw new IllegalArgumentException("CAD filename is required");
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".dwg")) return ".dwg";
        if (lower.endsWith(".dxf")) return ".dxf";
        throw new IllegalArgumentException("Only DWG and DXF files are accepted");
    }

    public static String copy(InputStream input, long reportedSize, String name, Path target, long maxBytes) throws IOException {
        String ext = extension(name);
        if (maxBytes <= 0 || reportedSize <= 0 || reportedSize > maxBytes) {
            throw new IllegalArgumentException("CAD file is empty or exceeds the configured upload limit");
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] header = input.readNBytes(8192);
            validateHeader(header, ext);
            long count = header.length;
            try (var output = Files.newOutputStream(target)) {
                if (count > maxBytes) throw new IllegalArgumentException("CAD upload limit exceeded");
                output.write(header);
                digest.update(header);
                byte[] buffer = new byte[64 * 1024];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("CAD upload interrupted");
                    count += length;
                    if (count > maxBytes) throw new IllegalArgumentException("CAD upload limit exceeded");
                    output.write(buffer, 0, length);
                    digest.update(buffer, 0, length);
                }
            }
            if (count != reportedSize) throw new IllegalArgumentException("Incomplete CAD upload");
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException | RuntimeException e) {
            try { Files.deleteIfExists(target); } catch (IOException cleanup) { e.addSuppressed(cleanup); }
            throw e;
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static void validateHeader(byte[] bytes, String extension) {
        String text = new String(bytes, StandardCharsets.US_ASCII);
        if (extension.equals(".dwg")) {
            if (!text.matches("(?s)^AC10[0-9A-Fa-f]{2}.*")) throw new IllegalArgumentException("Invalid DWG signature");
            return;
        }
        if (text.startsWith("AutoCAD Binary DXF\r\n\032\0")) return;
        // ASCII DXF may start with 999 comment pairs. Never accept a SECTION
        // substring in unrelated data. Validation is intentionally bounded.
        String[] lines = text.split("\\r?\\n");
        int i = 0;
        while (i + 1 < lines.length && lines[i].trim().equals("999")) i += 2;
        if (i + 1 >= lines.length || !lines[i].trim().equals("0") || !lines[i + 1].trim().equals("SECTION")) {
            throw new IllegalArgumentException("Invalid DXF section header");
        }
    }
}
