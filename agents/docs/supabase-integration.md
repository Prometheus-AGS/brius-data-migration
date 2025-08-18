# Supabase Database Integration for Migration Agents

This document outlines the specific requirements and patterns for database migration agents when working with Supabase PostgreSQL databases.

## Authentication Requirements

### Service Role Authentication
All migration operations requiring admin privileges must use the Supabase service role key with proper headers:

```javascript
const supabaseHeaders = {
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
  'apikey': process.env.SUPABASE_SERVICE_ROLE,
  'Content-Type': 'application/json'
};
```

### Database Connection Patterns
Migration agents should use Supabase's REST API for database operations rather than direct PostgreSQL connections when admin privileges are required.

## Updated Agent Tool Implementations

### 1. Enhanced PostgreSQL Connector Tool

```typescript
// src/tools/supabase-postgres-connector.ts
import { Tool } from '@mastra/core';

export class SupabasePostgresConnector extends Tool {
  name = 'supabase-query';
  description = 'Execute PostgreSQL queries via Supabase API with service role authentication';
  
  private supabaseUrl: string;
  private serviceRoleKey: string;
  
  constructor() {
    super();
    this.supabaseUrl = process.env.SUPABASE_URL!;
    this.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE!;
  }
  
  async execute(params: {
    query: string;
    values?: any[];
    requiresAuth?: boolean;
  }) {
    const { query, values = [], requiresAuth = true } = params;
    
    if (requiresAuth) {
      return await this.executeWithServiceRole(query, values);
    } else {
      return await this.executePublicQuery(query, values);
    }
  }
  
  private async executeWithServiceRole(query: string, values: any[]) {
    const headers = {
      'Authorization': `Bearer ${this.serviceRoleKey}`,
      'apikey': this.serviceRoleKey,
      'Content-Type': 'application/json'
    };
    
    // For complex queries, use Supabase's SQL function or direct PostgreSQL connection
    // For standard operations, use REST API endpoints
    
    if (this.isRestApiCompatible(query)) {
      return await this.executeViaRestAPI(query, values, headers);
    } else {
      return await this.executeViaRPC(query, values, headers);
    }
  }
  
  private async executeViaRPC(query: string, values: any[], headers: any) {
    // Use Supabase RPC for complex SQL operations
    const response = await fetch(`${this.supabaseUrl}/rpc/execute_sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql_query: query,
        parameters: values
      })
    });
    
    if (!response.ok) {
      throw new Error(`Supabase RPC Error: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  private async executeViaRestAPI(query: string, values: any[], headers: any) {
    // Convert common SQL operations to REST API calls
    const apiCall = this.convertSQLToRestAPI(query, values);
    
    const response = await fetch(`${this.supabaseUrl}/rest/v1/${apiCall.endpoint}`, {
      method: apiCall.method,
      headers: {
        ...headers,
        'Prefer': apiCall.prefer || 'return=representation'
      },
      body: apiCall.body ? JSON.stringify(apiCall.body) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`Supabase REST API Error: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  private convertSQLToRestAPI(query: string, values: any[]) {
    // Convert INSERT INTO table_name to POST /table_name
    if (query.toLowerCase().includes('insert into')) {
      const tableName = this.extractTableName(query);
      return {
        endpoint: tableName,
        method: 'POST',
        body: this.extractInsertValues(query, values)
      };
    }
    
    // Convert SELECT FROM table_name to GET /table_name
    if (query.toLowerCase().includes('select') && query.toLowerCase().includes('from')) {
      const tableName = this.extractTableName(query);
      const filters = this.extractWhereClause(query, values);
      return {
        endpoint: `${tableName}${filters}`,
        method: 'GET'
      };
    }
    
    // Convert UPDATE table_name to PATCH /table_name
    if (query.toLowerCase().includes('update')) {
      const tableName = this.extractTableName(query);
      const filters = this.extractWhereClause(query, values);
      return {
        endpoint: `${tableName}${filters}`,
        method: 'PATCH',
        body: this.extractUpdateValues(query, values)
      };
    }
    
    throw new Error(`Query not convertible to REST API: ${query}`);
  }
}
```

### 2. Migration Execution Agent Updates

```typescript
// Enhanced Migration Execution Agent with Supabase integration
export class SupabaseMigrationExecutionAgent extends Agent {
  name = 'supabase-migration-execution';
  
  private supabase: SupabasePostgresConnector;
  
  constructor() {
    super();
    this.supabase = new SupabasePostgresConnector();
  }
  
  async execute(context: AgentContext) {
    const { request } = context;
    
    try {
      // All migration operations use service role authentication
      const migrationResult = await this.executeBatchMigration(request);
      
      // Update migration_control via Supabase API
      await this.updateMigrationProgress(request.migrationId, migrationResult);
      
      return migrationResult;
      
    } catch (error) {
      // Log error via Supabase with proper authentication
      await this.logMigrationError(request.migrationId, error);
      throw error;
    }
  }
  
  private async executeBatchMigration(request: any) {
    const { table, strategy, batchSize } = request;
    
    // Use Supabase service role for all operations
    const sourceData = await this.extractSourceData(table, batchSize);
    const transformedData = await this.transformData(sourceData, strategy);
    const insertResult = await this.insertViaSupabase(table.targetName, transformedData);
    
    return insertResult;
  }
  
  private async insertViaSupabase(tableName: string, data: any[]) {
    // Use Supabase REST API with service role authentication
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${tableName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Supabase insert failed: ${error}`);
    }
    
    return await response.json();
  }
  
  private async updateMigrationProgress(migrationId: string, result: any) {
    // Update migration_control table via Supabase API
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/migration_control?id=eq.${migrationId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records_processed: result.recordsProcessed,
        status: 'completed',
        completed_at: new Date().toISOString()
      })
    });
  }
}
```

## Migration Control Operations

### Creating Migration Control Records
```typescript
const createMigrationRecord = async (migrationData: any) => {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/migration_control`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(migrationData)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create migration record: ${await response.text()}`);
  }
  
  return await response.json();
};
```

### Creating Migration Mappings
```typescript
const createMigrationMappings = async (mappings: any[]) => {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/migration_mappings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(mappings)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create migration mappings: ${await response.text()}`);
  }
  
  return await response.json();
};
```

## Schema Analysis with Supabase

### Introspecting Database Schema
```typescript
const analyzeSupabaseSchema = async (tableName?: string) => {
  const endpoint = tableName 
    ? `/rest/v1/information_schema.columns?table_name=eq.${tableName}`
    : '/rest/v1/information_schema.columns';
    
  const response = await fetch(`${process.env.SUPABASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      'apikey': process.env.SUPABASE_SERVICE_ROLE
    }
  });
  
  if (!response.ok) {
    throw new Error(`Schema analysis failed: ${await response.text()}`);
  }
  
  return await response.json();
};
```

### Row Level Security Considerations
When migrating to Supabase, consider RLS policies:

```sql
-- Example RLS policy for migration_control (should be created via Supabase dashboard)
CREATE POLICY "Allow service role full access to migration_control" 
ON migration_control FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Example RLS policy for migration_mappings
CREATE POLICY "Allow service role full access to migration_mappings" 
ON migration_mappings FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);
```

## Error Handling Patterns

### Supabase-Specific Error Handling
```typescript
const handleSupabaseError = (response: Response, operation: string) => {
  if (!response.ok) {
    switch (response.status) {
      case 401:
        throw new Error(`Authentication failed for ${operation}. Check service role key.`);
      case 403:
        throw new Error(`Insufficient permissions for ${operation}. Check RLS policies.`);
      case 409:
        throw new Error(`Conflict in ${operation}. Possible duplicate key violation.`);
      case 422:
        throw new Error(`Validation error in ${operation}. Check data types and constraints.`);
      default:
        throw new Error(`Supabase error in ${operation}: ${response.statusText}`);
    }
  }
};
```

## Best Practices

### 1. Environment Variables
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE=your-service-role-jwt-token
SUPABASE_ANON_KEY=your-anon-key (for public operations)
```

### 2. Rate Limiting Considerations
Supabase has API rate limits. Implement retry logic with exponential backoff:

```typescript
const executeWithRetry = async (operation: () => Promise<any>, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }
};
```

### 3. Batch Size Optimization
Supabase REST API works best with smaller batch sizes:

```typescript
const SUPABASE_OPTIMAL_BATCH_SIZE = {
  small_tables: 100,    // < 1000 records
  medium_tables: 50,    // 1000-10000 records  
  large_tables: 25,     // > 10000 records
  junction_tables: 75   // Relationship tables
};
```

---

*This Supabase integration ensures that migration agents work seamlessly with Supabase's authentication model, RLS policies, and REST API patterns while maintaining the robustness of the original migration framework.*
