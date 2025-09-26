// Database Connection Utility
// Extends existing migration patterns for standardized database connections

import { Pool, PoolClient, PoolConfig } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface ConnectionPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

export interface TransactionContext {
  client: PoolClient;
  rollback: () => Promise<void>;
  commit: () => Promise<void>;
}

export class DatabaseConnectionManager {
  private pools: Map<string, Pool> = new Map();
  private configs: Map<string, DatabaseConfig> = new Map();

  /**
   * Initialize connection manager with default configurations
   */
  constructor() {
    this.initializeDefaultConfigs();
  }

  /**
   * Initialize default database configurations from environment variables
   */
  private initializeDefaultConfigs(): void {
    // Source database configuration (legacy)
    const sourceConfig: DatabaseConfig = {
      host: process.env.SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME || 'dispatch_dev',
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD || '',
      max: parseInt(process.env.SOURCE_DB_MAX_CONNECTIONS || '20'),
      idleTimeoutMillis: parseInt(process.env.SOURCE_DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.SOURCE_DB_CONNECTION_TIMEOUT || '60000')
    };

    // Target database configuration (Supabase)
    const targetConfig: DatabaseConfig = {
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'supabase_admin',
      password: process.env.TARGET_DB_PASSWORD || 'postgres',
      max: parseInt(process.env.TARGET_DB_MAX_CONNECTIONS || '20'),
      idleTimeoutMillis: parseInt(process.env.TARGET_DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.TARGET_DB_CONNECTION_TIMEOUT || '60000')
    };

    this.addConfig('source', sourceConfig);
    this.addConfig('target', targetConfig);
  }

  /**
   * Add a new database configuration
   */
  addConfig(name: string, config: DatabaseConfig): void {
    this.configs.set(name, config);
  }

  /**
   * Get or create a connection pool
   */
  getPool(name: string): Pool {
    if (this.pools.has(name)) {
      return this.pools.get(name)!;
    }

    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Database configuration '${name}' not found`);
    }

    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 60000,
      ssl: config.ssl ? { rejectUnauthorized: false } : false
    };

    const pool = new Pool(poolConfig);

    // Add error handler
    pool.on('error', (err, client) => {
      console.error(`Database pool error for '${name}':`, err);
    });

    // Add connection handler for debugging
    pool.on('connect', (client) => {
      console.debug(`New client connected to '${name}' database`);
    });

    this.pools.set(name, pool);
    return pool;
  }

  /**
   * Get source database pool (legacy database)
   */
  getSourcePool(): Pool {
    return this.getPool('source');
  }

  /**
   * Get target database pool (Supabase)
   */
  getTargetPool(): Pool {
    return this.getPool('target');
  }

  /**
   * Execute a query with automatic pool management
   */
  async query<T = any>(
    poolName: string,
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const pool = this.getPool(poolName);

    try {
      const result = await pool.query(text, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        command: result.command
      };
    } catch (error) {
      console.error(`Query failed on '${poolName}':`, error);
      throw error;
    }
  }

  /**
   * Execute a query on source database
   */
  async querySource<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.query<T>('source', text, params);
  }

  /**
   * Execute a query on target database
   */
  async queryTarget<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.query<T>('target', text, params);
  }

  /**
   * Start a transaction
   */
  async beginTransaction(poolName: string): Promise<TransactionContext> {
    const pool = this.getPool(poolName);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      return {
        client,
        rollback: async () => {
          try {
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
        },
        commit: async () => {
          try {
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Execute a function within a transaction
   */
  async withTransaction<T>(
    poolName: string,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = this.getPool(poolName);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a function within a transaction on target database
   */
  async withTargetTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return this.withTransaction('target', operation);
  }

  /**
   * Test database connectivity
   */
  async testConnection(poolName: string): Promise<{
    success: boolean;
    latency?: number;
    error?: string;
    version?: string;
  }> {
    try {
      const startTime = Date.now();
      const result = await this.query(poolName, 'SELECT version(), NOW() as current_time');
      const latency = Date.now() - startTime;

      return {
        success: true,
        latency,
        version: result.rows[0]?.version
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test all configured connections
   */
  async testAllConnections(): Promise<Map<string, any>> {
    const results = new Map();

    for (const [name] of this.configs) {
      const result = await this.testConnection(name);
      results.set(name, result);
    }

    return results;
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(poolName: string): ConnectionPoolStats | null {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return null;
    }

    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  }

  /**
   * Get all pool statistics
   */
  getAllPoolStats(): Map<string, ConnectionPoolStats> {
    const stats = new Map<string, ConnectionPoolStats>();

    for (const [name, pool] of this.pools) {
      stats.set(name, {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    }

    return stats;
  }

  /**
   * Check if a table exists
   */
  async tableExists(poolName: string, tableName: string, schema: string = 'public'): Promise<boolean> {
    try {
      const result = await this.query(
        poolName,
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
        )`,
        [schema, tableName]
      );

      return result.rows[0]?.exists || false;
    } catch (error) {
      console.error(`Error checking table existence for ${schema}.${tableName}:`, error);
      return false;
    }
  }

  /**
   * Get table row count efficiently
   */
  async getTableRowCount(
    poolName: string,
    tableName: string,
    schema: string = 'public',
    approximate: boolean = false
  ): Promise<number> {
    try {
      let query: string;
      let params: any[];

      if (approximate) {
        // Use PostgreSQL statistics for fast approximate count
        query = `
          SELECT reltuples::BIGINT AS count
          FROM pg_class C
          LEFT JOIN pg_namespace N ON N.oid = C.relnamespace
          WHERE C.relname = $1 AND N.nspname = $2
        `;
        params = [tableName, schema];
      } else {
        // Exact count (slower for large tables)
        query = `SELECT COUNT(*) as count FROM ${schema}.${tableName}`;
        params = [];
      }

      const result = await this.query(poolName, query, params);
      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      console.error(`Error getting row count for ${schema}.${tableName}:`, error);
      return 0;
    }
  }

  /**
   * Execute a batch of queries with error handling
   */
  async executeBatch(
    poolName: string,
    queries: Array<{ text: string; params?: any[] }>,
    continueOnError: boolean = false
  ): Promise<Array<{ success: boolean; result?: any; error?: string }>> {
    const results: Array<{ success: boolean; result?: any; error?: string }> = [];
    const pool = this.getPool(poolName);

    for (const query of queries) {
      try {
        const result = await pool.query(query.text, query.params);
        results.push({ success: true, result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage });

        if (!continueOnError) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Gracefully close all connections
   */
  async closeAll(): Promise<void> {
    const closingPromises = Array.from(this.pools.entries()).map(async ([name, pool]) => {
      try {
        await pool.end();
        console.log(`✅ Closed database pool: ${name}`);
      } catch (error) {
        console.error(`❌ Error closing pool ${name}:`, error);
      }
    });

    await Promise.allSettled(closingPromises);
    this.pools.clear();
  }

  /**
   * Close a specific connection pool
   */
  async closePool(poolName: string): Promise<void> {
    const pool = this.pools.get(poolName);
    if (pool) {
      try {
        await pool.end();
        this.pools.delete(poolName);
        console.log(`✅ Closed database pool: ${poolName}`);
      } catch (error) {
        console.error(`❌ Error closing pool ${poolName}:`, error);
        throw error;
      }
    }
  }

  /**
   * Validate database configuration
   */
  static validateConfig(config: DatabaseConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.host) errors.push('Host is required');
    if (!config.port || config.port < 1 || config.port > 65535) {
      errors.push('Port must be between 1 and 65535');
    }
    if (!config.database) errors.push('Database name is required');
    if (!config.user) errors.push('User is required');
    if (!config.password) errors.push('Password is required');

    if (config.max !== undefined && (config.max < 1 || config.max > 100)) {
      errors.push('Max connections must be between 1 and 100');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create a database connection manager with validated configs
   */
  static create(configs?: Map<string, DatabaseConfig>): DatabaseConnectionManager {
    const manager = new DatabaseConnectionManager();

    if (configs) {
      for (const [name, config] of configs) {
        const validation = this.validateConfig(config);
        if (!validation.valid) {
          throw new Error(`Invalid config for '${name}': ${validation.errors.join(', ')}`);
        }
        manager.addConfig(name, config);
      }
    }

    return manager;
  }
}

// Default singleton instance
export const dbConnections = new DatabaseConnectionManager();

// Helper functions for common operations
export async function withSourceConnection<T>(
  operation: (pool: Pool) => Promise<T>
): Promise<T> {
  return operation(dbConnections.getSourcePool());
}

export async function withTargetConnection<T>(
  operation: (pool: Pool) => Promise<T>
): Promise<T> {
  return operation(dbConnections.getTargetPool());
}

export async function withTargetTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  return dbConnections.withTargetTransaction(operation);
}