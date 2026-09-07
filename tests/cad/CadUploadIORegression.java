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

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

/** Run with -Xmx32m: the synthetic upload is four times the entire Java heap. */
public final class CadUploadIORegression {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static InputStream generated(long length) {
        return new InputStream() {
            final byte[] header = "0\nSECTION\n2\nHEADER\n".getBytes(StandardCharsets.US_ASCII);
            long offset;
            @Override public int read() {
                if (offset >= length) return -1;
                int value = offset < header.length ? header[(int) offset] : 'x';
                offset++;
                return value;
            }
            @Override public int read(byte[] bytes, int start, int count) {
                if (offset >= length) return -1;
                int n = (int) Math.min(count, length - offset);
                Arrays.fill(bytes, start, start + n, (byte) 'x');
                if (offset < header.length) {
                    int h = (int) Math.min(n, header.length - offset);
                    System.arraycopy(header, (int) offset, bytes, start, h);
                }
                offset += n;
                return n;
            }
        };
    }
    private static void reject(InputStream input, long size, String name, long limit, Path target) throws Exception {
        boolean rejected = false;
        try { CadUploadIO.copy(input, size, name, target, limit); }
        catch (IllegalArgumentException | java.io.IOException expected) { rejected = true; }
        check(rejected, "invalid input was accepted");
        check(!Files.exists(target), "partial upload was not removed");
    }
    public static void main(String[] args) throws Exception {
        Path target = Path.of(args[0]);
        long size = 128L * 1024 * 1024;
        long start = System.nanoTime();
        String checksum = CadUploadIO.copy(generated(size), size, "large.DXF", target, size);
        check(Files.size(target) == size, "large upload was truncated");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = input.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        check(HexFormat.of().formatHex(digest.digest()).equals(checksum), "upload hash mismatch");
        Files.delete(target);
        reject(generated(50000), 20000, "lie.dxf", 32768, target);
        reject(generated(20000), 20001, "truncated.dxf", 32768, target);
        reject(generated(20), 100, "too-large.dxf", 50, target);
        reject(generated(20), 20, "bad.exe", 100, target);
        byte[] bad = "garbage AC1027".getBytes(StandardCharsets.US_ASCII);
        reject(new ByteArrayInputStream(bad), bad.length, "bad.dwg", 100, target);
        bad = "garbage SECTION".getBytes(StandardCharsets.US_ASCII);
        reject(new ByteArrayInputStream(bad), bad.length, "bad.dxf", 100, target);
        Thread.currentThread().interrupt();
        reject(generated(50000), 50000, "cancelled.dxf", 100000, target);
        check(Thread.interrupted(), "interrupt flag lost");
        for (String valid : new String[]{"AC1027example", "AutoCAD Binary DXF\r\n\032\0example", "999\ncomment\n0\nSECTION\n"}) {
            byte[] content = valid.getBytes(StandardCharsets.US_ASCII);
            CadUploadIO.copy(new ByteArrayInputStream(content), content.length,
                    valid.startsWith("AC") ? "valid.dwg" : "valid.dxf", target, 1000);
            Files.delete(target);
        }
        System.out.printf(java.util.Locale.ROOT,
                "{\"inputBytes\":%d,\"maxHeapBytes\":%d,\"seconds\":%.3f,\"scope\":\"stream staging and negative cases; not HTTP or full CAD parsing\"}%n",
                size, Runtime.getRuntime().maxMemory(), (System.nanoTime()-start)/1e9);
    }
}
