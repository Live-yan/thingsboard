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

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

final class CadInlineResource {
    private static final int MAX_BYTES = 4 * 1024 * 1024;

    private CadInlineResource() { }

    static String decode(String encoded) throws IOException {
        if (encoded.isEmpty() || encoded.length() > 4 * ((MAX_BYTES + 2) / 3)) {
            throw new IOException("A single CAD instance is too complex; split this block before import");
        }
        try {
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length > MAX_BYTES) throw new IOException("CAD resource exceeds limit");
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (IllegalArgumentException e) {
            throw new IOException("Invalid CAD resource encoding", e);
        }
    }
}
