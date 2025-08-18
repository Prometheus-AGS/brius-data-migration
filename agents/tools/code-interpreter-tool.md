# Code Interpreter Tool with Microsandbox Integration

This document outlines the implementation of a secure code interpreter tool for database migration agents, leveraging secure containerized execution for safe code execution.

## Overview

The Code Interpreter Tool provides agents with the ability to dynamically generate and execute TypeScript code in a secure sandboxed environment. This is essential for migration agents that need to:

- Generate complex migration scripts based on schema analysis
- Execute data transformations with custom business logic
- Run validation scripts for migration verification
- Handle dynamic field mappings and data conversions

## Secure Code Execution Architecture

### Security Benefits
- **Process Isolation**: Each execution runs in a separate Docker container
- **Resource Protection**: CPU, memory, and execution time constraints
- **Network Security**: Controlled outbound network access
- **File System Protection**: Limited file system access
- **Timeout Protection**: Automatic termination of long-running code

## Tool Implementation

### 1. Core Code Interpreter Tool

```typescript
// src/tools/code-interpreter.ts
import { Tool } from '@mastra/core';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
  memoryUsage?: number;
}

export interface CodeExecutionOptions {
  timeout?: number; // milliseconds
  memoryLimit?: string; // e.g., '128m', '1g'
  networkAccess?: boolean;
  allowedPackages?: string[];
  environment?: Record<string, string>;
}

export class CodeInterpreterTool extends Tool {
  name = 'code-interpreter';
  description = 'Execute TypeScript code in a secure containerized environment';
  
  private sandboxDir: string;
  private defaultTimeout: number = 30000; // 30 seconds
  private defaultMemoryLimit: string = '256m';
  
  constructor(sandboxDir: string = '/tmp/migration-sandbox') {
    super();
    this.sandboxDir = sandboxDir;
  }
  
  async execute(params: {
    code: string;
    language: 'typescript' | 'javascript';
    options?: CodeExecutionOptions;
  }): Promise<CodeExecutionResult> {
    const { code, language, options = {} } = params;
    const startTime = Date.now();
    
    try {
      // Create unique execution environment
      const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const executionDir = path.join(this.sandboxDir, executionId);
      
      // Prepare sandbox environment
      await this.prepareSandboxEnvironment(executionDir, code, language, options);
      
      // Execute code in secure container
      const result = await this.executeInContainer(executionDir, options);
      
      // Cleanup
      await this.cleanupSandboxEnvironment(executionDir);
      
      const executionTime = Date.now() - startTime;
      
      return {
        success: true,
        output: result.stdout || result.output,
        executionTime,
        memoryUsage: this.extractMemoryUsage(result.stderr)
      };
      
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        output: '',
        error: error.message,
        executionTime
      };
    }
  }
  
  private async prepareSandboxEnvironment(
    executionDir: string, 
    code: string, 
    language: string,
    options: CodeExecutionOptions
  ): Promise<void> {
    // Create execution directory
    await execAsync(`mkdir -p ${executionDir}`);
    
    // Create package.json with migration-specific dependencies
    const packageJson = {
      name: 'migration-sandbox',
      version: '1.0.0',
      dependencies: {
        '@supabase/supabase-js': '^2.55.0',
        '@types/pg': '^8.15.5',
        'dotenv': '^17.2.1',
        'pg': '^8.16.3',
        'typescript': '^5.9.2',
        'ts-node': '^10.9.2',
        ...(options.allowedPackages?.reduce((acc, pkg) => {
          acc[pkg] = 'latest';
          return acc;
        }, {} as Record<string, string>) || {})
      }
    };
    
    writeFileSync(
      path.join(executionDir, 'package.json'), 
      JSON.stringify(packageJson, null, 2)
    );
    
    // Create TypeScript config
    if (language === 'typescript') {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true
        }
      };
      
      writeFileSync(
        path.join(executionDir, 'tsconfig.json'),
        JSON.stringify(tsconfig, null, 2)
      );
    }
    
    // Write the code to execute
    const fileName = language === 'typescript' ? 'main.ts' : 'main.js';
    const codeWithEnvironment = this.injectEnvironmentSetup(code, options.environment);
    
    writeFileSync(path.join(executionDir, fileName), codeWithEnvironment);
    
    // Create .env file if environment variables provided
    if (options.environment) {
      const envContent = Object.entries(options.environment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      writeFileSync(path.join(executionDir, '.env'), envContent);
    }
  }
  
  private async executeInContainer(
    executionDir: string, 
    options: CodeExecutionOptions
  ): Promise<any> {
    const timeout = options.timeout || this.defaultTimeout;
    const memoryLimit = options.memoryLimit || this.defaultMemoryLimit;
    const networkAccess = options.networkAccess !== false; // Default to true
    
    // Build Docker command for secure execution
    const dockerCmd = [
      'docker run',
      '--rm',
      `--memory=${memoryLimit}`,
      '--cpus="1.0"',
      `--network=${networkAccess ? 'bridge' : 'none'}`,
      `--volume=${executionDir}:/workspace`,
      '--workdir=/workspace',
      '--user=1000:1000', // Non-root user
      '--security-opt=no-new-privileges',
      '--cap-drop=ALL',
      '--read-only',
      '--tmpfs=/tmp:noexec,nosuid,size=50m',
      'node:18-alpine',
      '/bin/sh', '-c',
      '"npm install --silent && npx ts-node main.ts"'
    ].join(' ');
    
    // Execute with timeout
    const result = await Promise.race([
      execAsync(dockerCmd, { cwd: executionDir }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Execution timeout')), timeout)
      )
    ]);
    
    return result;
  }
  
  private injectEnvironmentSetup(code: string, environment?: Record<string, string>): string {
    const envSetup = environment ? `
import dotenv from 'dotenv';
dotenv.config();

// Injected environment variables
${Object.entries(environment).map(([key, value]) => 
  `process.env.${key} = process.env.${key} || '${value}';`
).join('\n')}
` : '';
    
    return `${envSetup}\n\n${code}`;
  }
  
  private extractMemoryUsage(stderr: string): number | undefined {
    // Extract memory usage from Docker stats if available
    const memoryMatch = stderr.match(/Memory usage: (\d+)MB/);
    return memoryMatch ? parseInt(memoryMatch[1]) : undefined;
  }
  
  private async cleanupSandboxEnvironment(executionDir: string): Promise<void> {
    try {
      await execAsync(`rm -rf ${executionDir}`);
    } catch (error) {
      console.warn('Failed to cleanup sandbox environment:', error);
    }
  }
}
```

### 2. Migration Code Templates

```typescript
// Migration code templates for common patterns
export class MigrationCodeTemplates {
  
  static generateTechnicianRolesMigration(params: {
    sourceRoles: Array<{id: number, name: string, abbrev: string}>;
    technicianProfileId: string;
  }): string {
    return `
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

// Helper function to map role names to technician_type enum
function mapRoleToTechnicianType(roleName: string): string {
  const name = roleName.toLowerCase();
  
  if (name.includes('designing') || name.includes('dt-')) return 'designing';
  if (name.includes('manufacturing') || name.includes('mt-')) return 'manufacturing';
  if (name.includes('sectioning') || name.includes('st') || name.includes('idb')) return 'sectioning';
  if (name.includes('remote') || name.includes('rt') || name.includes('dtr')) return 'remote';
  if (name.includes('supervisor') || name.includes('master')) return 'master';
  if (name.includes('inspect') || name.includes('quality')) return 'quality_control';
  
  return 'manufacturing'; // Default
}

async function migrateTechnicianRoles() {
  console.log('🚀 Starting technician_roles migration...');
  
  try {
    // Step 1: Create migration control record
    console.log('📝 Creating migration control record...');
    const { data: migrationRecord, error: controlError } = await supabase
      .from('migration_control')
      .insert({
        phase: 'execution',
        table_name: 'technician_roles',
        operation: 'code_interpreter_migration',
        status: 'running',
        total_records: ${params.sourceRoles.length},
        started_at: new Date().toISOString(),
        batch_size: ${params.sourceRoles.length},
        worker_id: 1,
        source_query: 'dispatch_role where group_id = 11'
      })
      .select('*')
      .single();
    
    if (controlError) {
      throw new Error(\`Failed to create migration control record: \${controlError.message}\`);
    }
    
    console.log('✅ Migration control record created:', migrationRecord.id);
    const migrationId = migrationRecord.id;
    
    // Step 2: Prepare technician role data
    console.log('🔄 Preparing technician role data...');
    
    const sourceRoles = ${JSON.stringify(params.sourceRoles, null, 2)};
    
    // Transform data for target schema
    const technicianRoles = sourceRoles.map(role => ({
      technician_id: '${params.technicianProfileId}',
      role_type: mapRoleToTechnicianType(role.name),
      role_name: role.name,
      abbreviation: role.abbrev || role.name.substring(0, 10),
      is_active: true,
      assigned_at: new Date().toISOString(),
      legacy_role_id: role.id
    }));
    
    console.log(\`📦 Prepared \${technicianRoles.length} technician role records\`);
    
    // Step 3: Insert technician roles
    console.log('💾 Inserting technician roles...');
    const { data: insertedRoles, error: insertError } = await supabase
      .from('technician_roles')
      .insert(technicianRoles)
      .select('*');
    
    if (insertError) {
      throw new Error(\`Failed to insert technician roles: \${insertError.message}\`);
    }
    
    console.log(\`✅ Inserted \${insertedRoles!.length} technician roles\`);
    
    // Step 4: Create migration mappings
    console.log('🔗 Creating migration mappings...');
    const mappings = insertedRoles!.map(role => ({
      entity_type: 'technician_roles',
      legacy_id: role.legacy_role_id,
      new_id: role.id,
      migrated_at: new Date().toISOString(),
      migration_batch: 'technician_roles_batch_1'
    }));
    
    const { error: mappingError } = await supabase
      .from('migration_mappings')
      .insert(mappings);
    
    if (mappingError) {
      throw new Error(\`Failed to create migration mappings: \${mappingError.message}\`);
    }
    
    console.log(\`✅ Created \${mappings.length} migration mappings\`);
    
    // Step 5: Update migration control record
    console.log('📊 Updating migration control...');
    const { error: updateError } = await supabase
      .from('migration_control')
      .update({
        status: 'completed',
        records_processed: insertedRoles!.length,
        completed_at: new Date().toISOString()
      })
      .eq('id', migrationId);
    
    if (updateError) {
      throw new Error(\`Failed to update migration control: \${updateError.message}\`);
    }
    
    console.log('✅ Migration control updated');
    
    // Step 6: Validation
    console.log('🔍 Validating migration...');
    const { count } = await supabase
      .from('technician_roles')
      .select('*', { count: 'exact', head: true });
    
    console.log('📈 Migration Results:');
    console.log(\`   • Source records: ${params.sourceRoles.length}\`);
    console.log(\`   • Migrated records: \${insertedRoles!.length}\`);
    console.log(\`   • Current total: \${count}\`);
    console.log(\`   • Migration mappings: \${mappings.length}\`);
    
    console.log('🎉 technician_roles migration completed successfully!');
    
    return {
      status: 'SUCCESS',
      recordsMigrated: insertedRoles!.length,
      mappingsCreated: mappings.length,
      migrationId: migrationId
    };
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Execute migration and output results
migrateTechnicianRoles()
  .then(result => {
    console.log('MIGRATION_RESULT:', JSON.stringify(result));
    process.exit(0);
  })
  .catch(error => {
    console.error('MIGRATION_ERROR:', error.message);
    process.exit(1);
  });
`;
  }
}
```

## Agent Integration

### Enhanced Migration Execution Agent

```typescript
export class EnhancedMigrationExecutionAgent extends Agent {
  name = 'enhanced-migration-execution';
  
  private codeInterpreter: CodeInterpreterTool;
  
  constructor() {
    super();
    this.codeInterpreter = new CodeInterpreterTool();
  }
  
  async execute(context: AgentContext) {
    const { request } = context;
    
    try {
      // Generate migration code based on table type and strategy
      const migrationCode = this.generateMigrationCode(request);
      
      // Execute code in secure container
      const executionResult = await this.codeInterpreter.execute({
        code: migrationCode,
        language: 'typescript',
        options: {
          timeout: 300000, // 5 minutes
          memoryLimit: '512m',
          networkAccess: true,
          environment: {
            SUPABASE_URL: process.env.SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE!,
            SOURCE_DB_HOST: process.env.SOURCE_DB_HOST!,
            SOURCE_DB_PORT: process.env.SOURCE_DB_PORT!,
            SOURCE_DB_USER: process.env.SOURCE_DB_USER!,
            SOURCE_DB_PASSWORD: process.env.SOURCE_DB_PASSWORD!,
            SOURCE_DB_NAME: process.env.SOURCE_DB_NAME!
          }
        }
      });
      
      if (!executionResult.success) {
        throw new Error(\`Migration execution failed: \${executionResult.error}\`);
      }
      
      // Parse execution results
      const results = this.parseExecutionOutput(executionResult.output);
      
      return {
        status: 'SUCCESS',
        recordsMigrated: results.recordsMigrated,
        executionTime: executionResult.executionTime,
        memoryUsage: executionResult.memoryUsage,
        migrationId: results.migrationId
      };
      
    } catch (error: any) {
      return {
        status: 'FAILED',
        error: error.message,
        suggestion: this.generateErrorSuggestion(error)
      };
    }
  }
  
  private parseExecutionOutput(output: string): any {
    // Look for structured JSON results
    const resultMatch = output.match(/MIGRATION_RESULT: ({.*})/);
    if (resultMatch) {
      try {
        return JSON.parse(resultMatch[1]);
      } catch (error) {
        console.warn('Failed to parse JSON result, falling back to text parsing');
      }
    }
    
    // Fallback to text parsing
    const recordsMatch = output.match(/(\d+) records migrated/);
    const mappingsMatch = output.match(/(\d+) migration mappings/);
    
    return {
      recordsMigrated: recordsMatch ? parseInt(recordsMatch[1]) : 0,
      mappingsCreated: mappingsMatch ? parseInt(mappingsMatch[1]) : 0,
      success: output.includes('🎉') || output.includes('completed successfully')
    };
  }
}
```

## Updated Agent System Prompt

```
You execute database migration code in a secure containerized environment using TypeScript.

CODE GENERATION:
- Generate complete, executable TypeScript migration scripts
- Use the established patterns from the existing codebase
- Include comprehensive error handling and progress logging
- Follow Supabase authentication patterns with service role keys

CONTAINER EXECUTION:
- All code runs in isolated Docker containers with resource limits
- Memory limit: 512MB, CPU limit: 1.0, execution timeout: 5 minutes
- Network access controlled per migration requirements
- Environment variables injected securely for database connections

MIGRATION PATTERNS:
- technician_roles: Catalog migration with enum mapping
- junction_tables: Many-to-many relationship migration with UUID mapping
- catalog_data: Simple reference table migration with metadata enhancement

OUTPUT PARSING:
- Look for MIGRATION_RESULT: JSON in output for structured results
- Parse text output for fallback extraction of migration statistics
- Handle both success and error scenarios gracefully

SECURITY:
- Never expose credentials in generated code (use environment variables)
- Validate all generated code structure before execution
- Monitor execution time and resource usage
- Automatic cleanup of temporary files and containers
```

---

*The Code Interpreter Tool provides secure, controlled execution of dynamically generated TypeScript migration code, enabling agents to handle complex database transformations while maintaining strict security boundaries.*
