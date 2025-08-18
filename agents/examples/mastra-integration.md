# Mastra Framework Integration Guide

This guide demonstrates how to implement the database migration agent system using the Mastra framework, providing practical code examples and deployment patterns.

## Project Structure

```
migration-agents/
├── package.json
├── mastra.config.ts
├── src/
│   ├── agents/
│   │   ├── orchestrator.ts
│   │   ├── schema-analysis.ts
│   │   ├── planning.ts
│   │   ├── data-mapping.ts
│   │   ├── migration-execution.ts
│   │   ├── validation.ts
│   │   └── user-guidance.ts
│   ├── workflows/
│   │   ├── discovery-flow.ts
│   │   ├── migration-flow.ts
│   │   └── validation-flow.ts
│   ├── tools/
│   │   ├── postgres-connector.ts
│   │   ├── schema-introspector.ts
│   │   └── batch-processor.ts
│   └── types/
│       ├── migration-types.ts
│       └── agent-interfaces.ts
└── db/
    ├── migrations/
    └── schemas/
```

## Package Dependencies

```json
{
  "name": "database-migration-agents",
  "version": "1.0.0",
  "dependencies": {
    "@mastra/core": "^0.1.0",
    "@mastra/memory": "^0.1.0", 
    "@mastra/workflows": "^0.1.0",
    "pg": "^8.11.0",
    "@types/pg": "^8.10.0",
    "uuid": "^9.0.0",
    "@types/uuid": "^9.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  },
  "scripts": {
    "dev": "mastra dev",
    "build": "mastra build", 
    "deploy": "mastra deploy",
    "test": "mastra test"
  }
}
```

## Mastra Configuration

```typescript
// mastra.config.ts
import { MastraConfig } from '@mastra/core';

export default {
  name: 'database-migration-agents',
  agents: [
    {
      name: 'orchestrator',
      description: 'Master migration coordinator',
      instructions: 'coord_instructions.md',
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-sonnet'
      }
    },
    {
      name: 'schema-analysis', 
      description: 'PostgreSQL schema analyst',
      instructions: 'schema_instructions.md',
      model: {
        provider: 'ANTHROPIC', 
        name: 'claude-3-sonnet'
      }
    },
    {
      name: 'planning',
      description: 'Migration strategy planner',
      instructions: 'planning_instructions.md', 
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-sonnet'  
      }
    },
    {
      name: 'data-mapping',
      description: 'Data transformation specialist',
      instructions: 'mapping_instructions.md',
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-sonnet'
      }
    },
    {
      name: 'migration-execution',
      description: 'Batch migration executor', 
      instructions: 'execution_instructions.md',
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-sonnet'
      }
    },
    {
      name: 'validation',
      description: 'Data integrity validator',
      instructions: 'validation_instructions.md',
      model: {
        provider: 'ANTHROPIC', 
        name: 'claude-3-sonnet'
      }
    },
    {
      name: 'user-guidance',
      description: 'User interface and guidance',
      instructions: 'guidance_instructions.md',
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-sonnet'
      }
    }
  ],
  workflows: [
    {
      name: 'discovery-workflow',
      triggerSchema: 'discovery-trigger.json'
    },
    {
      name: 'migration-workflow', 
      triggerSchema: 'migration-trigger.json'
    },
    {
      name: 'validation-workflow',
      triggerSchema: 'validation-trigger.json'
    }
  ],
  tools: [
    {
      name: 'postgres-query',
      description: 'Execute PostgreSQL queries'
    },
    {
      name: 'schema-introspect', 
      description: 'Analyze database schemas'
    },
    {
      name: 'batch-migrate',
      description: 'Process data migration batches'
    }
  ],
  memory: {
    provider: 'LOCAL_STORAGE',
    config: {
      persistencePath: './data/agent-memory'  
    }
  }
} satisfies MastraConfig;
```

## Agent Implementation Examples

### 1. Orchestrator Agent

```typescript
// src/agents/orchestrator.ts
import { Agent, AgentContext } from '@mastra/core';
import { MigrationWorkflow } from '../workflows/migration-flow';
import { MigrationControlTable } from '../types/migration-types';

export class OrchestratorAgent extends Agent {
  name = 'orchestrator';
  
  async execute(context: AgentContext) {
    const { request, memory } = context;
    
    try {
      // Initialize migration tracking
      const migrationId = await this.initializeMigration(request);
      
      // Coordinate discovery phase
      const schemaAnalysis = await this.coordinateDiscovery(migrationId);
      
      // Create migration plan
      const migrationPlan = await this.coordinatePlanning(schemaAnalysis);
      
      // Execute migration with progress tracking
      const migrationResults = await this.coordinateExecution(migrationPlan);
      
      // Validate results
      const validationResults = await this.coordinateValidation(migrationResults);
      
      // Communicate success to user
      await this.communicateCompletion(validationResults);
      
      return {
        status: 'SUCCESS',
        migrationId,
        results: validationResults
      };
      
    } catch (error) {
      await this.handleError(error, context);
      return {
        status: 'FAILED', 
        error: error.message,
        recovery: await this.planRecovery(error)
      };
    }
  }
  
  private async coordinateDiscovery(migrationId: string) {
    // Update migration control
    await this.updateMigrationStatus(migrationId, 'discovery', 'running');
    
    // Delegate to Schema Analysis Agent
    const schemaResults = await this.callAgent('schema-analysis', {
      task: 'analyze_full_schema',
      migrationId
    });
    
    await this.updateMigrationStatus(migrationId, 'discovery', 'completed');
    return schemaResults;
  }
  
  private async coordinatePlanning(schemaAnalysis: any) {
    // Delegate to Planning Agent
    return await this.callAgent('planning', {
      task: 'create_migration_strategy',
      schemaAnalysis,
      preferences: {
        batchSize: 'auto',
        parallelism: 'conservative',
        errorHandling: 'pause_and_notify'
      }
    });
  }
  
  private async coordinateExecution(migrationPlan: any) {
    const results = [];
    
    // Execute each phase in dependency order
    for (const phase of migrationPlan.phases) {
      const phaseResult = await this.executePhase(phase);
      results.push(phaseResult);
      
      if (phaseResult.status === 'FAILED') {
        // Coordinate error handling
        const recovery = await this.coordinateErrorRecovery(phaseResult);
        if (recovery.action === 'ABORT') {
          throw new Error(`Migration failed in phase ${phase.name}: ${phaseResult.error}`);
        }
      }
    }
    
    return results;
  }
  
  private async executePhase(phase: any) {
    // Coordinate parallel agent execution
    const agentTasks = [
      this.callAgent('data-mapping', { phase }),
      this.callAgent('migration-execution', { phase }), 
      this.callAgent('validation', { phase })
    ];
    
    const results = await Promise.all(agentTasks);
    
    return {
      phase: phase.name,
      status: 'SUCCESS',
      agentResults: results
    };
  }
}
```

### 2. Schema Analysis Agent  

```typescript
// src/agents/schema-analysis.ts
import { Agent, AgentContext } from '@mastra/core';
import { PostgresConnector } from '../tools/postgres-connector';
import { SchemaIntrospector } from '../tools/schema-introspector';

export class SchemaAnalysisAgent extends Agent {
  name = 'schema-analysis';
  
  private postgres: PostgresConnector;
  private introspector: SchemaIntrospector;
  
  constructor() {
    super();
    this.postgres = new PostgresConnector();
    this.introspector = new SchemaIntrospector();
  }
  
  async execute(context: AgentContext) {
    const { request } = context;
    
    switch (request.task) {
      case 'analyze_full_schema':
        return await this.analyzeFullSchema(request);
      case 'compare_schemas':
        return await this.compareSchemas(request);
      case 'profile_table_data':
        return await this.profileTableData(request);
      default:
        throw new Error(`Unknown task: ${request.task}`);
    }
  }
  
  private async analyzeFullSchema(request: any) {
    const { sourceDb, targetDb } = request;
    
    // Introspect source database
    const sourceSchema = await this.introspector.introspectDatabase(sourceDb);
    
    // Introspect target database  
    const targetSchema = await this.introspector.introspectDatabase(targetDb);
    
    // Classify tables based on patterns
    const tableClassifications = await this.classifyTables(sourceSchema);
    
    // Detect relationships
    const relationships = await this.detectRelationships(sourceSchema);
    
    // Find mismatches
    const schemaMismatches = await this.findSchemaMismatches(sourceSchema, targetSchema);
    
    return {
      sourceSchema,
      targetSchema,
      tableClassifications,
      relationships,
      schemaMismatches,
      recommendations: this.generateRecommendations(tableClassifications, relationships)
    };
  }
  
  private async classifyTables(schema: any) {
    const classifications = {};
    
    for (const table of schema.tables) {
      const recordCount = await this.getTableRecordCount(table.name);
      const columnCount = table.columns.length;
      const foreignKeyCount = table.foreignKeys.length;
      
      // Apply classification logic from successful migrations
      if (recordCount < 5000 && columnCount < 10 && foreignKeyCount <= 1) {
        classifications[table.name] = {
          type: 'catalog',
          complexity: 'low',
          migrationStrategy: 'bulk_insert',
          batchSize: 500
        };
      } else if (foreignKeyCount >= 2 && columnCount <= 6) {
        classifications[table.name] = {
          type: 'junction',
          complexity: 'medium', 
          migrationStrategy: 'foreign_key_mapping',
          batchSize: 200,
          dependencies: this.extractDependencies(table.foreignKeys)
        };
      } else {
        classifications[table.name] = {
          type: 'transactional',
          complexity: 'high',
          migrationStrategy: 'incremental_with_validation', 
          batchSize: 100
        };
      }
    }
    
    return classifications;
  }
  
  private async detectRelationships(schema: any) {
    // Implementation of relationship detection logic
    // Based on successful junction table discoveries
    return this.introspector.detectJunctionTables(schema);
  }
}
```

### 3. Migration Execution Agent

```typescript  
// src/agents/migration-execution.ts
import { Agent, AgentContext } from '@mastra/core';
import { BatchProcessor } from '../tools/batch-processor';
import { MigrationControlService } from '../services/migration-control';

export class MigrationExecutionAgent extends Agent {
  name = 'migration-execution';
  
  private batchProcessor: BatchProcessor;
  private migrationControl: MigrationControlService;
  
  constructor() {
    super();
    this.batchProcessor = new BatchProcessor();
    this.migrationControl = new MigrationControlService();
  }
  
  async execute(context: AgentContext) {
    const { request } = context;
    const { table, strategy, batchSize = 100 } = request;
    
    try {
      // Start migration tracking
      const migrationId = await this.migrationControl.startMigration({
        phase: 'execution',
        tableName: table.name,
        operation: 'batch_migration',
        batchSize,
        totalRecords: table.recordCount
      });
      
      // Execute batch migration based on strategy
      const result = await this.executeBatchMigration(table, strategy, batchSize, migrationId);
      
      // Complete migration tracking
      await this.migrationControl.completeMigration(migrationId, result);
      
      return result;
      
    } catch (error) {
      await this.migrationControl.failMigration(migrationId, error.message);
      throw error;
    }
  }
  
  private async executeBatchMigration(table: any, strategy: any, batchSize: number, migrationId: string) {
    const totalRecords = table.recordCount;
    const totalBatches = Math.ceil(totalRecords / batchSize);
    let processedRecords = 0;
    
    for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber++) {
      const offset = (batchNumber - 1) * batchSize;
      
      // Process batch based on strategy
      const batchResult = await this.processBatch({
        table,
        strategy,
        batchNumber,
        batchSize,
        offset,
        migrationId
      });
      
      processedRecords += batchResult.recordsProcessed;
      
      // Update progress
      await this.migrationControl.updateProgress(migrationId, processedRecords);
      
      // Coordinate with Validation Agent for batch verification
      await this.callAgent('validation', {
        task: 'validate_batch',
        table: table.name,
        batchNumber,
        expectedRecords: Math.min(batchSize, totalRecords - offset)
      });
      
      // Small delay to prevent overwhelming the database
      await this.sleep(100);
    }
    
    return {
      status: 'SUCCESS',
      recordsProcessed: processedRecords,
      batchesCompleted: totalBatches
    };
  }
  
  private async processBatch(config: any) {
    const { table, strategy, batchNumber, batchSize, offset, migrationId } = config;
    
    switch (strategy.type) {
      case 'catalog_migration':
        return await this.processCatalogBatch(config);
      case 'junction_migration':
        return await this.processJunctionBatch(config);
      case 'transactional_migration':
        return await this.processTransactionalBatch(config);
      default:
        throw new Error(`Unknown migration strategy: ${strategy.type}`);
    }
  }
  
  private async processCatalogBatch(config: any) {
    // Implement catalog migration (like brackets)
    // Simple bulk insert with metadata enrichment
    const { table, batchSize, offset } = config;
    
    const sourceRecords = await this.batchProcessor.extractBatch({
      table: table.name,
      limit: batchSize,
      offset
    });
    
    const transformedRecords = sourceRecords.map(record => ({
      ...record,
      id: this.generateUUID(),
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { migrated_from_legacy_id: record.id }
    }));
    
    await this.batchProcessor.insertBatch({
      targetTable: table.targetName || table.name,
      records: transformedRecords
    });
    
    return { recordsProcessed: sourceRecords.length };
  }
}
```

## Workflow Definitions

### Discovery Workflow

```typescript
// src/workflows/discovery-flow.ts  
import { Workflow, WorkflowContext } from '@mastra/workflows';

export class DiscoveryWorkflow extends Workflow {
  name = 'discovery-workflow';
  
  async execute(context: WorkflowContext) {
    const { trigger } = context;
    
    // Step 1: Schema Analysis
    const schemaAnalysis = await this.runStep('schema-analysis', {
      task: 'analyze_full_schema',
      sourceDb: trigger.sourceDatabase,
      targetDb: trigger.targetDatabase
    });
    
    // Step 2: Planning
    const migrationPlan = await this.runStep('planning', {
      task: 'create_migration_strategy', 
      schemaAnalysis
    });
    
    // Step 3: User Guidance
    const userGuidance = await this.runStep('user-guidance', {
      task: 'present_migration_plan',
      plan: migrationPlan,
      requiresApproval: true
    });
    
    return {
      schemaAnalysis,
      migrationPlan,
      userApproval: userGuidance.approved
    };
  }
}
```

## Database Tools Implementation

### PostgreSQL Connector Tool

```typescript
// src/tools/postgres-connector.ts
import { Tool } from '@mastra/core';
import { Pool } from 'pg';

export class PostgresConnector extends Tool {
  name = 'postgres-query';
  description = 'Execute PostgreSQL queries with connection pooling';
  
  private pools = new Map<string, Pool>();
  
  async execute(params: {
    database: string;
    query: string; 
    values?: any[];
  }) {
    const { database, query, values = [] } = params;
    
    const pool = this.getPool(database);
    const client = await pool.connect();
    
    try {
      const result = await client.query(query, values);
      return result.rows;
    } finally {
      client.release();
    }
  }
  
  private getPool(database: string): Pool {
    if (!this.pools.has(database)) {
      this.pools.set(database, new Pool({
        connectionString: process.env[`${database.toUpperCase()}_DATABASE_URL`],
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      }));
    }
    
    return this.pools.get(database)!;
  }
}
```

## Deployment Configuration

### Development Server

```typescript
// src/dev-server.ts
import { MastraApp } from '@mastra/core';
import config from '../mastra.config';

const app = new MastraApp(config);

app.listen(3000, () => {
  console.log('🤖 Database Migration Agents running on http://localhost:3000');
  console.log('🔍 Available agents:', config.agents.map(a => a.name).join(', '));
});
```

### Production Deployment

```typescript
// Example Vercel deployment
// vercel.json
{
  "functions": {
    "src/agents/*.ts": {
      "runtime": "@vercel/node"
    }
  },
  "env": {
    "SOURCE_DATABASE_URL": "@source-db-url",
    "TARGET_DATABASE_URL": "@target-db-url",
    "ANTHROPIC_API_KEY": "@anthropic-api-key"
  }
}
```

## Usage Examples

### Starting a Migration

```typescript
// Client usage example
import { MastraClient } from '@mastra/core';

const client = new MastraClient({
  baseUrl: 'http://localhost:3000'
});

// Start complete migration
const migrationResult = await client.runWorkflow('discovery-workflow', {
  sourceDatabase: 'legacy_system',
  targetDatabase: 'new_system',
  userEmail: 'user@company.com'
});

console.log('Migration completed:', migrationResult);
```

### Monitoring Progress

```typescript
// Real-time progress monitoring
const migrationStream = client.streamWorkflow('migration-workflow', {
  migrationPlan: discoveryResult.migrationPlan
});

migrationStream.on('progress', (update) => {
  console.log(`Progress: ${update.percentage}% - ${update.message}`);
});

migrationStream.on('error', (error) => {
  console.error('Migration error:', error);
});

migrationStream.on('complete', (result) => {
  console.log('Migration completed successfully:', result);
});
```

---

*This Mastra integration provides a production-ready foundation for the database migration agent system, with proper error handling, progress tracking, and scalable deployment options.*
