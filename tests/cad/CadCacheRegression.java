/*
 * Copyright © 2016-2026 The Thingsboard Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.thingsboard.server.service.entitiy.cad;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicLong;

public class CadCacheRegression {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        AtomicLong time = new AtomicLong();
        CadResultCache cache = new CadResultCache(6, 10, time::get);
        byte[] result = {1, 2, 3};
        cache.put("tenant-a:source:revision-1", result);
        result[0] = 99;
        check(cache.get("tenant-a:source:revision-1")[0] == 1);
        cache.get("tenant-a:source:revision-1")[0] = 99;
        check(cache.get("tenant-a:source:revision-1")[0] == 1);
        check(cache.get("tenant-b:source:revision-1") == null);
        check(cache.get("tenant-a:source:revision-2") == null);
        cache.put("b", new byte[3]); cache.put("c", new byte[3]);
        check(cache.get("tenant-a:source:revision-1") == null);
        time.set(10); check(cache.get("c") == null);
        cache.put("too-large", new byte[7]); check(cache.get("too-large") == null);
        CadResultCache off = new CadResultCache(100, 0, time::get);
        off.put("a", result); check(off.get("a") == null);
        String svg = "<svg>中文泵站</svg>";
        check(CadInlineResource.decode(Base64.getEncoder().encodeToString(svg.getBytes(StandardCharsets.UTF_8))).equals(svg));
        for (String invalid : new String[]{"", "not-base64!", "/w=="}) {
            boolean failed = false;
            try { CadInlineResource.decode(invalid); } catch (java.io.IOException e) { failed = true; }
            check(failed);
        }
        byte[] oversized = new byte[4 * 1024 * 1024 + 1];
        boolean failed = false;
        try { CadInlineResource.decode(Base64.getEncoder().encodeToString(oversized)); }
        catch (java.io.IOException e) { failed = true; }
        check(failed);
        System.out.println("Cache isolation, copy ownership, TTL, bounds and UTF-8 contracts passed");
    }
}
