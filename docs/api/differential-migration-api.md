# Differential Migration API Documentation

## Overview

The Differential Migration API provides RESTful endpoints for managing database migration operations with incremental sync capabilities. This API enables baseline analysis, change detection, migration execution, and real-time monitoring of database synchronization processes.

**Base URL**: `/api/migration`
**API Version**: 1.0
**Content-Type**: `application/json`

## Authentication

All API endpoints require proper database credentials configured via environment variables or passed in request headers for source and destination database connections.

## API Endpoints

### 1. Baseline Analysis

**POST** `/api/migration/baseline`

Analyzes the current state between source and destination databases to identify gaps and synchronization status.

#### Request Body

```json
{
  "entities": ["offices", "doctors", "patients"],
  "includeMappings": true,
  "outputFormat": "json",
  "dryRun": false,
  "verbose": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entities` | `string[]` | Yes | List of entity types to analyze |
| `includeMappings` | `boolean` | No | Include mapping validation (default: false) |
| `outputFormat` | `'json' \| 'csv' \| 'table'` | No | Response format (default: json) |
| `dryRun` | `boolean` | No | Perform analysis without modifications (default: false) |
| `verbose` | `boolean` | No | Include detailed diagnostic information (default: false) |

#### Response

```json
{
  "success": true,
  "data": {
    "analysisId": "baseline-2025-10-26-abc123",
    "timestamp": "2025-10-26T10:30:00.000Z",
    "overallStatus": "gaps_detected",
    "entitySummary": [
      {
        "entityType": "offices",
        "sourceCount": 1250,
        "destinationCount": 1200,
        "recordGap": 50,
        "gapPercentage": 4.0,
        "status": "behind",
        "lastMigrationTimestamp": "2025-10-25T18:00:00.000Z"
      }
    ],
    "summary": {
      "totalSourceRecords": 50000,
      "totalDestinationRecords": 48500,
      "overallGap": 1500,
      "averageGapPercentage": 3.0
    },
    "mappingValidation": [
      {
        "entityType": "offices",
        "isValid": true,
        "issues": {
          "missingMappings": 0,
          "orphanedMappings": 2,
          "schemaChanges": 0
        }
      }
    ]
  }
}
```

#### Status Codes

- `200` - Analysis completed successfully
- `400` - Invalid request parameters
- `500` - Internal server error during analysis

---

### 2. Differential Detection

**POST** `/api/migration/detect`

Detects changes between source and destination databases since a specified timestamp or last sync.

#### Request Body

```json
{
  "entities": ["offices", "doctors"],
  "sinceTimestamp": "2025-10-25T18:00:00.000Z",
  "includeDeletes": true,
  "batchSize": 1000,
  "enableContentHashing": true,
  "outputFormat": "json"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entities` | `string[]` | Yes | Entity types to check for changes |
| `sinceTimestamp` | `string` | No | ISO timestamp for change detection baseline |
| `includeDeletes` | `boolean` | No | Detect deleted records (default: true) |
| `batchSize` | `number` | No | Records per batch (default: 1000) |
| `enableContentHashing` | `boolean` | No | Use content hashing for change detection (default: true) |
| `outputFormat` | `'json' \| 'csv'` | No | Response format (default: json) |

#### Response

```json
{
  "success": true,
  "data": {
    "detectionId": "detect-2025-10-26-def456",
    "timestamp": "2025-10-26T10:35:00.000Z",
    "summary": {
      "totalChanges": 125,
      "newRecords": 45,
      "modifiedRecords": 70,
      "deletedRecords": 10,
      "entitiesAffected": ["offices", "doctors"]
    },
    "entityResults": [
      {
        "entityType": "offices",
        "changes": 25,
        "newRecords": 10,
        "modifiedRecords": 15,
        "deletedRecords": 0,
        "lastProcessedTimestamp": "2025-10-26T10:35:00.000Z"
      }
    ],
    "changesDetected": [
      {
        "entityType": "offices",
        "recordId": "1234",
        "changeType": "modified",
        "timestamp": "2025-10-26T09:15:00.000Z",
        "fieldChanges": ["address", "phone"],
        "contentHash": "abc123def456"
      }
    ],
    "performance": {
      "totalDurationMs": 1250,
      "recordsPerSecond": 4000,
      "batchesProcessed": 15
    }
  }
}
```

#### Status Codes

- `200` - Detection completed successfully
- `400` - Invalid request parameters
- `422` - Invalid timestamp format
- `500` - Internal server error during detection

---

### 3. Migration Execution

**POST** `/api/migration/execute`

Executes migration of detected changes with checkpointing and recovery capabilities.

#### Request Body

```json
{
  "migrationTasks": [
    {
      "entityType": "offices",
      "recordIds": ["1", "2", "3"],
      "priority": "high",
      "dependencies": [],
      "estimatedDurationMs": 30000
    }
  ],
  "executionConfig": {
    "batchSize": 500,
    "maxRetryAttempts": 3,
    "checkpointInterval": 10,
    "parallelEntityLimit": 2,
    "timeoutMs": 300000,
    "enableValidation": true,
    "dryRun": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `migrationTasks` | `MigrationTask[]` | Yes | Array of migration tasks to execute |
| `executionConfig` | `ExecutionConfig` | No | Migration execution configuration |

#### MigrationTask Schema

```typescript
interface MigrationTask {
  entityType: string;
  recordIds: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencies: string[];
  estimatedDurationMs: number;
  metadata?: {
    sourceTable: string;
    destinationTable: string;
    totalRecords: number;
    migrationMethod: string;
  };
}
```

#### ExecutionConfig Schema

```typescript
interface ExecutionConfig {
  batchSize?: number;                // Records per batch (default: 500)
  maxRetryAttempts?: number;         // Retry attempts per batch (default: 3)
  checkpointInterval?: number;       // Batches between checkpoints (default: 10)
  parallelEntityLimit?: number;     // Max parallel entities (default: 2)
  timeoutMs?: number;               // Operation timeout (default: 300000)
  enableValidation?: boolean;        // Enable post-migration validation (default: true)
  validationSampleSize?: number;     // Sample size for validation (default: 10)
  dryRun?: boolean;                 // Simulate without actual changes (default: false)
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "executionId": "exec-2025-10-26-ghi789",
    "sessionId": "session-abc123",
    "startTime": "2025-10-26T10:40:00.000Z",
    "endTime": "2025-10-26T10:45:30.000Z",
    "overallStatus": "completed",
    "totalRecordsProcessed": 1250,
    "totalRecordsFailed": 5,
    "entitiesProcessed": [
      {
        "entityType": "offices",
        "status": "completed",
        "recordsProcessed": 500,
        "recordsFailed": 0,
        "startTime": "2025-10-26T10:40:00.000Z",
        "endTime": "2025-10-26T10:42:15.000Z"
      }
    ],
    "checkpoints": [
      {
        "checkpointId": "cp-offices-batch-10",
        "entityType": "offices",
        "batchNumber": 10,
        "recordsProcessed": 500,
        "timestamp": "2025-10-26T10:42:00.000Z",
        "status": "completed"
      }
    ],
    "executionSummary": {
      "totalDurationMs": 330000,
      "averageThroughput": 227.3,
      "peakThroughput": 400,
      "peakMemoryUsageMb": 156
    },
    "validation": {
      "validationPerformed": true,
      "samplesValidated": 125,
      "validationSuccess": true,
      "integrityIssues": []
    }
  }
}
```

#### Status Codes

- `200` - Migration completed successfully
- `202` - Migration started (for async operations)
- `400` - Invalid migration tasks or configuration
- `409` - Migration already in progress
- `500` - Internal server error during migration

---

### 4. Status Monitoring

**GET** `/api/migration/status/{sessionId}`

Retrieves real-time status of migration operations.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | Yes | Migration session identifier |

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeDetails` | `boolean` | No | Include detailed entity progress (default: false) |
| `format` | `'json' \| 'table'` | No | Response format (default: json) |

#### Response

```json
{
  "success": true,
  "data": {
    "sessionId": "session-abc123",
    "overallStatus": "running",
    "progress": {
      "totalEntities": 3,
      "completedEntities": 1,
      "currentEntity": "doctors",
      "overallPercentage": 45.5
    },
    "entityProgress": [
      {
        "entityType": "offices",
        "status": "completed",
        "progress": {
          "recordsProcessed": 1200,
          "totalRecords": 1200,
          "percentage": 100,
          "currentBatch": 24,
          "totalBatches": 24
        },
        "timing": {
          "startTime": "2025-10-26T10:40:00.000Z",
          "endTime": "2025-10-26T10:42:15.000Z",
          "durationMs": 135000
        },
        "performance": {
          "recordsPerSecond": 133.3,
          "memoryUsageMb": 45
        }
      }
    ],
    "performance": {
      "overallThroughput": 180.5,
      "memoryUsage": 125,
      "cpuUsage": 65.2
    },
    "lastUpdate": "2025-10-26T10:44:30.000Z"
  }
}
```

#### Status Codes

- `200` - Status retrieved successfully
- `404` - Session not found
- `500` - Internal server error

---

### 5. Logs Management

**GET** `/api/migration/logs/{sessionId}`

Retrieves migration logs with filtering and streaming capabilities.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | Yes | Migration session identifier |

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | `'error' \| 'warn' \| 'info' \| 'debug'` | No | Minimum log level |
| `entityType` | `string` | No | Filter by entity type |
| `since` | `string` | No | ISO timestamp to filter logs since |
| `limit` | `number` | No | Maximum number of log entries (default: 100) |
| `format` | `'json' \| 'text'` | No | Response format (default: json) |
| `stream` | `boolean` | No | Enable real-time streaming (default: false) |

#### Response

```json
{
  "success": true,
  "data": {
    "sessionId": "session-abc123",
    "logEntries": [
      {
        "timestamp": "2025-10-26T10:40:15.000Z",
        "level": "info",
        "entityType": "offices",
        "batchNumber": 5,
        "message": "Processed batch 5: 50 records migrated successfully",
        "details": {
          "recordsProcessed": 50,
          "processingTimeMs": 1250,
          "memoryUsageMb": 42
        }
      },
      {
        "timestamp": "2025-10-26T10:40:20.000Z",
        "level": "warn",
        "entityType": "offices",
        "batchNumber": 6,
        "message": "Retry attempt 1 for batch 6 due to connection timeout",
        "details": {
          "error": "Connection timeout after 5000ms",
          "retryAttempt": 1,
          "maxRetries": 3
        }
      }
    ],
    "summary": {
      "totalEntries": 245,
      "errorCount": 3,
      "warningCount": 12,
      "infoCount": 200,
      "debugCount": 30
    },
    "filters": {
      "level": "info",
      "entityType": null,
      "since": "2025-10-26T10:40:00.000Z"
    }
  }
}
```

#### Streaming Response (when `stream=true`)

For real-time log streaming, the response uses Server-Sent Events (SSE):

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"timestamp":"2025-10-26T10:45:00.000Z","level":"info","message":"Batch 15 completed","entityType":"doctors"}

data: {"timestamp":"2025-10-26T10:45:05.000Z","level":"debug","message":"Memory usage: 145MB","entityType":"doctors"}
```

#### Status Codes

- `200` - Logs retrieved successfully
- `404` - Session not found
- `400` - Invalid query parameters
- `500` - Internal server error

---

## Error Handling

All API endpoints follow consistent error response format:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_ENTITIES",
    "message": "One or more entity types are invalid",
    "details": {
      "invalidEntities": ["invalid_entity"],
      "validEntities": ["offices", "doctors", "patients", "orders"]
    },
    "timestamp": "2025-10-26T10:30:00.000Z",
    "requestId": "req-abc123"
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `INVALID_ENTITIES` | Invalid entity types specified |
| `DATABASE_CONNECTION_ERROR` | Cannot connect to source or destination database |
| `MIGRATION_IN_PROGRESS` | Migration already running for session |
| `SESSION_NOT_FOUND` | Migration session does not exist |
| `INVALID_TIMESTAMP` | Timestamp format is invalid |
| `VALIDATION_FAILED` | Post-migration validation failed |
| `CHECKPOINT_CORRUPTED` | Migration checkpoint data is corrupted |
| `RESOURCE_EXHAUSTED` | System resources exhausted |

---

## Rate Limiting

- **Baseline Analysis**: 10 requests per minute
- **Differential Detection**: 20 requests per minute
- **Migration Execution**: 5 requests per minute
- **Status Monitoring**: 60 requests per minute
- **Logs**: 30 requests per minute

Rate limit headers are included in all responses:
- `X-RateLimit-Limit`: Request limit per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## WebSocket Support (Real-time Updates)

For real-time migration progress updates, connect to:

**WebSocket URL**: `ws://localhost:3000/api/migration/ws/{sessionId}`

### WebSocket Messages

#### Progress Update
```json
{
  "type": "progress_update",
  "sessionId": "session-abc123",
  "entityType": "doctors",
  "data": {
    "recordsProcessed": 450,
    "totalRecords": 1000,
    "percentage": 45.0,
    "currentBatch": 9,
    "estimatedTimeRemaining": 120000
  }
}
```

#### Status Change
```json
{
  "type": "status_change",
  "sessionId": "session-abc123",
  "entityType": "offices",
  "oldStatus": "running",
  "newStatus": "completed",
  "timestamp": "2025-10-26T10:42:15.000Z"
}
```

#### Error Notification
```json
{
  "type": "error",
  "sessionId": "session-abc123",
  "entityType": "patients",
  "error": {
    "code": "BATCH_FAILED",
    "message": "Batch 15 failed after 3 retry attempts",
    "batchNumber": 15,
    "retryable": false
  }
}
```

---

## SDK Examples

### Node.js/TypeScript

```typescript
import axios from 'axios';

const migrationApi = axios.create({
  baseURL: 'http://localhost:3000/api/migration',
  headers: { 'Content-Type': 'application/json' }
});

// Baseline analysis
const baselineResponse = await migrationApi.post('/baseline', {
  entities: ['offices', 'doctors'],
  includeMappings: true,
  verbose: true
});

// Change detection
const changesResponse = await migrationApi.post('/detect', {
  entities: ['offices'],
  sinceTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  includeDeletes: true
});

// Migration execution
const migrationResponse = await migrationApi.post('/execute', {
  migrationTasks: [
    {
      entityType: 'offices',
      recordIds: ['1', '2', '3'],
      priority: 'high',
      dependencies: [],
      estimatedDurationMs: 30000
    }
  ],
  executionConfig: {
    batchSize: 100,
    enableValidation: true
  }
});
```

### cURL Examples

```bash
# Baseline analysis
curl -X POST http://localhost:3000/api/migration/baseline \
  -H "Content-Type: application/json" \
  -d '{"entities":["offices","doctors"],"verbose":true}'

# Change detection
curl -X POST http://localhost:3000/api/migration/detect \
  -H "Content-Type: application/json" \
  -d '{"entities":["offices"],"includeDeletes":true}'

# Status monitoring
curl -X GET "http://localhost:3000/api/migration/status/session-abc123?includeDetails=true"

# Log streaming
curl -X GET "http://localhost:3000/api/migration/logs/session-abc123?stream=true&level=info"
```

---

## Performance Considerations

- **Batch Size**: Optimize based on record size and system resources (recommended: 500-2000)
- **Parallel Entities**: Balance throughput vs resource usage (recommended: 2-4)
- **Checkpointing**: More frequent checkpoints enable faster recovery but increase overhead
- **Validation**: Sample-based validation provides good coverage with minimal performance impact
- **Memory Usage**: Monitor peak memory usage, especially for large batch sizes

---

## Security

- **Database Credentials**: Never include credentials in API requests; use environment variables
- **Input Validation**: All inputs are validated and sanitized
- **SQL Injection Protection**: Parameterized queries prevent SQL injection
- **Rate Limiting**: Prevents API abuse and resource exhaustion
- **HTTPS Only**: Production deployments must use HTTPS
- **Session Security**: Migration sessions include cryptographic tokens

---

## Monitoring & Observability

- **Health Check**: `GET /api/migration/health`
- **Metrics**: Prometheus metrics available at `/api/migration/metrics`
- **Tracing**: Distributed tracing with correlation IDs
- **Logging**: Structured JSON logs with migration context
- **Alerting**: Configurable alerts for failures, performance degradation

For more information, see the [CLI Documentation](./cli-help.md) and [Integration Guide](./integration-guide.md).