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
package org.thingsboard.server.config;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "cad")
@Data
public class CadConfig {

    private String pythonPath = "python";
    private String scriptPath;
    private int conversionTimeoutSeconds = 300;
    private int maxFileSizeMb = 50;
    private String tempDir;
    private int maxEntities = 5000;
    private int maxConcurrentConversions = 2;
    private int maxOutputSizeMb = 64;
    @Value("${cad.cache-size-mb:${CAD_CACHE_SIZE_MB:16}}")
    private int cacheSizeMb = 16;
    @Value("${cad.cache-ttl-seconds:${CAD_CACHE_TTL_SECONDS:60}}")
    private int cacheTtlSeconds = 60;

}
