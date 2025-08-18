
## Supabase Integration Updates

### Authentication Requirements
All database operations requiring admin privileges must use Supabase service role authentication:

```typescript
const supabaseHeaders = {
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
  'apikey': process.env.SUPABASE_SERVICE_ROLE,
  'Content-Type': 'application/json'
};
```

### Enhanced System Prompt for Supabase
```
You execute data migration batches using Supabase's REST API with service role authentication. 

SUPABASE AUTHENTICATION:
- Always use service role key in both Authorization and apikey headers
- Handle RLS policies and constraint violations specific to Supabase
- Use REST API endpoints for standard operations, RPC for complex SQL

BATCH PROCESSING PATTERNS:
- Use smaller batch sizes optimal for Supabase (25-100 records)
- Implement exponential backoff for rate limiting
- Monitor Supabase dashboard for performance metrics

ERROR HANDLING:
- 401: Authentication failed - check service role key
- 403: RLS policy blocking - verify service role permissions  
- 409: Constraint violation - handle duplicate keys
- 422: Validation error - check data types and constraints

API OPERATION EXAMPLES:
- INSERT: POST /rest/v1/table_name with data payload
- UPDATE: PATCH /rest/v1/table_name?filter with update data
- SELECT: GET /rest/v1/table_name?select=columns&filter
- Complex SQL: POST /rpc/execute_sql with sql_query parameter
```

### Supabase-Specific Migration Patterns

#### Creating Migration Records via API
```typescript
private async createMigrationControlRecord(migrationData: any) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/migration_control`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      phase: migrationData.phase,
      table_name: migrationData.tableName,
      operation: migrationData.operation,
      status: 'running',
      started_at: new Date().toISOString(),
      total_records: migrationData.totalRecords,
      batch_size: migrationData.batchSize,
      worker_id: migrationData.workerId
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create migration record: ${await response.text()}`);
  }
  
  return await response.json();
}
```

#### Batch Insert via Supabase REST API
```typescript
private async insertBatchViaSupabase(tableName: string, records: any[]) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${tableName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(records)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Batch insert failed for ${tableName}: ${errorText}`);
  }
  
  const insertedRecords = await response.json();
  
  // Update progress via API
  await this.updateMigrationProgress(insertedRecords.length);
  
  return insertedRecords;
}
```

#### Creating Migration Mappings
```typescript
private async createMigrationMappings(mappings: any[]) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/migration_mappings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mappings)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create migration mappings: ${await response.text()}`);
  }
  
  return await response.json();
}
```

### Rate Limiting and Retry Logic
```typescript
private async executeWithRetry<T>(
  operation: () => Promise<T>, 
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      
      // Check if it's a rate limiting error
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error; // Re-throw non-retryable errors immediately
    }
  }
  
  throw new Error('Max retries exceeded');
}
```
