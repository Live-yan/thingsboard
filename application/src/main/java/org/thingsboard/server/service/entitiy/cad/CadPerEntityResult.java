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

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class CadPerEntityResult {

    private String previewSvgBase64;
    private List<CadEntityInfo> manifest;
    private ModelspaceBounds modelspaceBounds;
    private PreviewTransform previewTransform;

    private String sceneId;
    private int schemaVersion;
    private int sourceEntityCount;
    private int unrenderedEntityCount;
    private int skippedPrimitiveCount;
    private String backgroundColor;
    private List<ConversionWarning> warnings = List.of();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConversionWarning {
        private String handle;
        private String type;
        private String reason;
    }

    public CadPerEntityResult(String preview, List<CadEntityInfo> manifest,
                              ModelspaceBounds bounds, PreviewTransform transform) {
        this.previewSvgBase64 = preview;
        this.manifest = manifest;
        this.modelspaceBounds = bounds;
        this.previewTransform = transform;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ModelspaceBounds {
        private double minX;
        private double maxX;
        private double minY;
        private double maxY;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class PreviewTransform {
        private double x;
        private double y;
        private double width;
        private double height;
        private double scale;
        private double translateX;
        private double translateY;
        private boolean yFlip;
    }

}
