/**
 * T010: Database connection manager
 * Standardized database connection handling for all migration scripts
 */

import { Client, Pool, PoolConfig } from 'pg';
import { DatabaseConfig, ConnectionStatus } from '../interfaces/migration-types';

export class DatabaseConnectionManager {
  private sourcePool: Pool | null = null;
  private targetPool: Pool | null = null;
  private sourceClient: Client | null = null;
  private targetClient: Client | null = null;

  constructor(
    private sourceConfig: DatabaseConfig,
    private targetConfig: DatabaseConfig
  ) {}

  /**
   * Initialize connection pools for batch processing
   */
  async initializePools(): Promise<void> {
    console.log('🔌 Initializing database connection pools...');

    try {
      // Source database pool
      const sourcePoolConfig: PoolConfig = {
        host: this.sourceConfig.host,
        port: this.sourceConfig.port,
        user: this.sourceConfig.user,
        password: this.sourceConfig.password,
        database: this.sourceConfig.database,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        statement_timeout: 300000,
        query_timeout: 300000
      };

      this.sourcePool = new Pool(sourcePoolConfig);

      // Target database pool
      const targetPoolConfig: PoolConfig = {
        host: this.targetConfig.host,
        port: this.targetConfig.port,
        user: this.targetConfig.user,
        password: this.targetConfig.password,
        database: this.targetConfig.database,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        statement_timeout: 300000,
        query_timeout: 300000
      };

      this.targetPool = new Pool(targetPoolConfig);

      // Test connections
      await this.testConnections();

      console.log('✅ Database connection pools initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize database pools:', error);
      throw error;
    }
  }

  /**
   * Initialize single client connections for simple operations
   */
  async initializeClients(): Promise<void> {
    console.log('🔌 Initializing database client connections...');

    try {
      // Source database client
      this.sourceClient = new Client({
        host: this.sourceConfig.host,
        port: this.sourceConfig.port,
        user: this.sourceConfig.user,
        password: this.sourceConfig.password,
        database: this.sourceConfig.database,
        statement_timeout: 300000,
        query_timeout: 300000
      });

      // Target database client
      this.targetClient = new Client({
        host: this.targetConfig.host,
        port: this.targetConfig.port,
        user: this.targetConfig.user,
        password: this.targetConfig.password,
        database: this.targetConfig.database,
        statement_timeout: 300000,
        query_timeout: 300000
      });

      await this.sourceClient.connect();
      await this.targetClient.connect();

      console.log('✅ Database client connections established successfully');
    } catch (error) {
      console.error('❌ Failed to initialize database clients:', error);
      throw error;
    }
  }

  /**
   * Get source database pool connection
   */
  getSourcePool(): Pool {
    if (!this.sourcePool) {
      throw new Error('Source pool not initialized. Call initializePools() first.');
    }
    return this.sourcePool;
  }

  /**
   * Get target database pool connection
   */
  getTargetPool(): Pool {
    if (!this.targetPool) {
      throw new Error('Target pool not initialized. Call initializePools() first.');
    }
    return this.targetPool;
  }

  /**
   * Get source database client connection
   */
  getSourceClient(): Client {
    if (!this.sourceClient) {
      throw new Error('Source client not initialized. Call initializeClients() first.');
    }
    return this.sourceClient;
  }

  /**
   * Get target database client connection
   */
  getTargetClient(): Client {
    if (!this.targetClient) {
      throw new Error('Target client not initialized. Call initializeClients() first.');
    }
    return this.targetClient;
  }

  /**
   * Test database connections
   */
  async testConnections(): Promise<ConnectionStatus> {
    console.log('🔍 Testing database connections...');

    const status: ConnectionStatus = {
      sourceConnected: false,
      targetConnected: false,
      sourceError: null,
      targetError: null
    };

    // Test source connection
    try {
      if (this.sourcePool) {
        const client = await this.sourcePool.connect();
        const result = await client.query('SELECT NOW() as current_time');
        client.release();
        status.sourceConnected = true;
        console.log('✅ Source database connection successful');
      } else if (this.sourceClient) {
        await this.sourceClient.query('SELECT NOW() as current_time');
        status.sourceConnected = true;
        console.log('✅ Source database connection successful');
      }
    } catch (error: any) {
      status.sourceError = error.message;
      console.error('❌ Source database connection failed:', error.message);
    }

    // Test target connection
    try {
      if (this.targetPool) {
        const client = await this.targetPool.connect();
        const result = await client.query('SELECT NOW() as current_time');
        client.release();
        status.targetConnected = true;
        console.log('✅ Target database connection successful');
      } else if (this.targetClient) {
        await this.targetClient.query('SELECT NOW() as current_time');
        status.targetConnected = true;
        console.log('✅ Target database connection successful');
      }
    } catch (error: any) {
      status.targetError = error.message;
      console.error('❌ Target database connection failed:', error.message);
    }

    return status;
  }

  /**
   * Execute query with retry logic
   */
  async executeQuery(
    client: Client | Pool,
    query: string,
    params?: any[],
    retryAttempts: number = 3
  ): Promise<any> {
    let lastError: Error;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        if (client instanceof Pool) {
          const poolClient = await client.connect();
          try {
            const result = await poolClient.query(query, params);
            return result;
          } finally {
            poolClient.release();
          }
        } else {
          return await client.query(query, params);
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`Query attempt ${attempt}/${retryAttempts} failed: ${error.message}`);

        if (attempt < retryAttempts) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await this.delay(delay);
        }
      }
    }

    throw new Error(`Query failed after ${retryAttempts} attempts: ${lastError!.message}`);
  }

  /**
   * Execute transaction with rollback on error
   */
  async executeTransaction(
    client: Client,
    queries: Array<{ query: string; params?: any[] }>
  ): Promise<any[]> {
    const results: any[] = [];

    try {
      await client.query('BEGIN');

      for (const { query, params } of queries) {
        const result = await client.query(query, params);
        results.push(result);
      }

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Get database version and basic info
   */
  async getDatabaseInfo(client: Client): Promise<{
    version: string;
    database: string;
    host: string;
    port: number;
  }> {
    const versionResult = await client.query('SELECT version()');
    const dbResult = await client.query('SELECT current_database()');

    return {
      version: versionResult.rows[0].version,
      database: dbResult.rows[0].current_database,
      host: client.host || 'unknown',
      port: client.port || 0
    };
  }

  /**
   * Check if table exists
   */
  async tableExists(client: Client, tableName: string, schema: string = 'public'): Promise<boolean> {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = $1
        AND table_name = $2
      )
    `, [schema, tableName]);

    return result.rows[0].exists;
  }

  /**
   * Get table record count
   */
  async getRecordCount(client: Client, tableName: string): Promise<number> {
    const result = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Get table schema information
   */
  async getTableSchema(client: Client, tableName: string): Promise<Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>> {
    const result = await client.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    return result.rows;
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    console.log('🔌 Closing database connections...');

    try {
      if (this.sourcePool) {
        await this.sourcePool.end();
        this.sourcePool = null;
      }

      if (this.targetPool) {
        await this.targetPool.end();
        this.targetPool = null;
      }

      if (this.sourceClient) {
        await this.sourceClient.end();
        this.sourceClient = null;
      }

      if (this.targetClient) {
        await this.targetClient.end();
        this.targetClient = null;
      }

      console.log('✅ All database connections closed successfully');
    } catch (error) {
      console.error('❌ Error closing database connections:', error);
      throw error;
    }
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a connection manager from environment variables
   */
  static fromEnvironment(): DatabaseConnectionManager {
    const sourceConfig: DatabaseConfig = {
      host: process.env.SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD || '',
      database: process.env.SOURCE_DB_NAME || 'source_db'
    };

    const targetConfig: DatabaseConfig = {
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      user: process.env.TARGET_DB_USER || 'postgres',
      password: process.env.TARGET_DB_PASSWORD || '',
      database: process.env.TARGET_DB_NAME || 'postgres'
    };

    return new DatabaseConnectionManager(sourceConfig, targetConfig);
  }

  /**
   * Health check for monitoring
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    connections: {
      source: 'connected' | 'disconnected' | 'error';
      target: 'connected' | 'disconnected' | 'error';
    };
    details?: any;
  }> {
    try {
      const connectionStatus = await this.testConnections();

      const status = connectionStatus.sourceConnected && connectionStatus.targetConnected
        ? 'healthy'
        : 'unhealthy';

      return {
        status,
        connections: {
          source: connectionStatus.sourceConnected
            ? 'connected'
            : connectionStatus.sourceError
              ? 'error'
              : 'disconnected',
          target: connectionStatus.targetConnected
            ? 'connected'
            : connectionStatus.targetError
              ? 'error'
              : 'disconnected'
        },
        details: {
          sourceError: connectionStatus.sourceError,
          targetError: connectionStatus.targetError
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connections: {
          source: 'error',
          target: 'error'
        },
        details: { error: (error as Error).message }
      };
    }
  }
}

// Export singleton instance for convenience
export const globalConnectionManager = DatabaseConnectionManager.fromEnvironment();

// Connection factory functions for different use cases
export class ConnectionFactory {
  /**
   * Create connection manager for migration operations
   */
  static createForMigration(): DatabaseConnectionManager {
    return DatabaseConnectionManager.fromEnvironment();
  }

  /**
   * Create connection manager with custom configuration
   */
  static create(sourceConfig: DatabaseConfig, targetConfig: DatabaseConfig): DatabaseConnectionManager {
    return new DatabaseConnectionManager(sourceConfig, targetConfig);
  }

  /**
   * Create connection manager for validation operations
   */
  static createForValidation(): DatabaseConnectionManager {
    const manager = DatabaseConnectionManager.fromEnvironment();
    // Validation typically uses client connections for simpler operations
    return manager;
  }

  /**
   * Create connection manager for batch processing
   */
  static createForBatchProcessing(): DatabaseConnectionManager {
    const manager = DatabaseConnectionManager.fromEnvironment();
    // Batch processing benefits from connection pools
    return manager;
  }
}