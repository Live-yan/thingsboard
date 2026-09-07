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

@Data
@AllArgsConstructor
@NoArgsConstructor
public class CadEntityInfo {

    private String id;
    private String type;
    private String svgBase64;
    private double x;
    private double y;
    private double width;
    private double height;
    private String blockName;
    private double previewX;
    private double previewY;
    private double previewWidth;
    private double previewHeight;

    private String handle;
    private String layer;

    public CadEntityInfo(String id, String type, String svgBase64, double x, double y,
                         double width, double height, String blockName,
                         double previewX, double previewY, double previewWidth, double previewHeight) {
        this.id = id;
        this.type = type;
        this.svgBase64 = svgBase64;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.blockName = blockName;
        this.previewX = previewX;
        this.previewY = previewY;
        this.previewWidth = previewWidth;
        this.previewHeight = previewHeight;
    }
}
