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
package org.thingsboard.server.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.thingsboard.server.queue.util.TbCoreComponent;
import org.thingsboard.server.service.entitiy.cad.CadConvertResult;
import org.thingsboard.server.service.entitiy.cad.CadPerEntityResult;
import org.thingsboard.server.service.entitiy.cad.CadService;

@Slf4j
@RestController
@TbCoreComponent
@RequiredArgsConstructor
@RequestMapping("/api")
public class CadController extends BaseController {

    private final CadService cadService;

    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')")
    @PostMapping(value = "/cad/convert", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<CadConvertResult> convertCadFile(
            @RequestPart MultipartFile file) throws Exception {
        try (var input = file.getInputStream()) {
            var result = cadService.convertDwgToSvg(
                    input, file.getSize(),
                    file.getOriginalFilename(),
                    getCurrentUser().getTenantId()
            );
            return ResponseEntity.ok(result);
        }
    }

    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')")
    @PostMapping(value = "/cad/convert-per-entity", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<CadPerEntityResult> convertCadFilePerEntity(
            @RequestPart MultipartFile file) throws Exception {
        try (var input = file.getInputStream()) {
            var result = cadService.convertDwgToPerEntitySvg(
                    input, file.getSize(),
                    file.getOriginalFilename(),
                    getCurrentUser().getTenantId()
            );
            return ResponseEntity.ok(result);
        }
    }

}
