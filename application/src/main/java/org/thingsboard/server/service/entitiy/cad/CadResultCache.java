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

import java.util.LinkedHashMap;
import java.util.function.LongSupplier;

/** Bounded, process-local cache of immutable serialized results, keyed by tenant.
 * This is not a source-file repository. No entries survive a service restart.
 */
final class CadResultCache {
    private record Entry(byte[] bytes, long created) { }
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>(16, 0.75f, true);
    private final long maxBytes;
    private final long ttlNanos;
    private final LongSupplier clock;
    private long bytes;

    CadResultCache(long maxBytes, long ttlNanos) { this(maxBytes, ttlNanos, System::nanoTime); }

    CadResultCache(long maxBytes, long ttlNanos, LongSupplier clock) {
        if (maxBytes < 0 || ttlNanos < 0) throw new IllegalArgumentException("Negative CAD cache limit");
        this.maxBytes = maxBytes;
        this.ttlNanos = ttlNanos;
        this.clock = clock;
    }

    long maxEntryBytes() { return ttlNanos == 0 ? 0 : Math.min(maxBytes, 4L * 1024 * 1024); }

    synchronized byte[] get(String key) {
        expire();
        Entry entry = entries.get(key);
        return entry == null ? null : entry.bytes.clone();
    }

    synchronized void put(String key, byte[] value) {
        expire();
        Entry old = entries.remove(key);
        if (old != null) bytes -= old.bytes.length;
        if (value.length == 0 || value.length > maxEntryBytes()) return;
        while (!entries.isEmpty() && (bytes + value.length > maxBytes || entries.size() >= 32)) {
            var iterator = entries.entrySet().iterator();
            bytes -= iterator.next().getValue().bytes.length;
            iterator.remove();
        }
        entries.put(key, new Entry(value.clone(), clock.getAsLong()));
        bytes += value.length;
    }

    private void expire() {
        long now = clock.getAsLong();
        var iterator = entries.values().iterator();
        while (iterator.hasNext()) {
            Entry entry = iterator.next();
            if (now - entry.created >= ttlNanos) {
                bytes -= entry.bytes.length;
                iterator.remove();
            }
        }
    }
}
