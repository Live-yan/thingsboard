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
package org.thingsboard.server.service.edge;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.thingsboard.server.cluster.TbClusterService;
import org.thingsboard.server.common.data.TbResourceInfo;
import org.thingsboard.server.common.data.edge.EdgeEventActionType;
import org.thingsboard.server.common.data.id.EdgeId;
import org.thingsboard.server.common.data.id.TbResourceId;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.dao.edge.EdgeSynchronizationManager;
import org.thingsboard.server.dao.eventsourcing.SaveEntityEvent;
import org.thingsboard.server.dao.tenant.TenantService;

import java.util.UUID;

import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EdgeEventSourcingListenerTest {

    @Mock
    private TbClusterService tbClusterService;
    @Mock
    private TenantService tenantService;
    @Mock
    private EdgeSynchronizationManager edgeSynchronizationManager;

    private EdgeEventSourcingListener listener;

    @BeforeEach
    void setUp() {
        listener = new EdgeEventSourcingListener(tbClusterService, tenantService, edgeSynchronizationManager);
    }

    @Test
    void handleSaveEntityEventWithoutEdgeContextDoesNotNotifyEdge() {
        when(edgeSynchronizationManager.getEdgeId()).thenReturn(new ThreadLocal<>());
        TenantId tenantId = new TenantId(UUID.randomUUID());
        TbResourceInfo resource = new TbResourceInfo();
        resource.setTenantId(tenantId);

        listener.handleEvent(SaveEntityEvent.<TbResourceInfo>builder()
                .tenantId(tenantId)
                .entity(resource)
                .entityId(new TbResourceId(UUID.randomUUID()))
                .created(true)
                .broadcastEvent(true)
                .build());

        verifyNoInteractions(tbClusterService);
    }

    @Test
    void handleSaveEntityEventWithEdgeContextNotifiesEdge() {
        EdgeId edgeId = new EdgeId(UUID.randomUUID());
        ThreadLocal<EdgeId> edgeIdContext = new ThreadLocal<>();
        edgeIdContext.set(edgeId);
        when(edgeSynchronizationManager.getEdgeId()).thenReturn(edgeIdContext);
        TenantId tenantId = new TenantId(UUID.randomUUID());
        TbResourceInfo resource = new TbResourceInfo();
        resource.setTenantId(tenantId);
        TbResourceId resourceId = new TbResourceId(UUID.randomUUID());

        listener.handleEvent(SaveEntityEvent.<TbResourceInfo>builder()
                .tenantId(tenantId)
                .entity(resource)
                .entityId(resourceId)
                .created(true)
                .broadcastEvent(true)
                .build());

        verify(tbClusterService).sendNotificationMsgToEdge(
                eq(tenantId), isNull(), eq(resourceId), isNull(), isNull(), eq(EdgeEventActionType.ADDED), eq(edgeId));
    }
}
