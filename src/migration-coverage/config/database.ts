/**
 * Database Configuration
 *
 * Manages database connections for the Migration Coverage API.
 */

import { Pool, PoolConfig, Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  connectionTimeout?: number;
  idleTimeout?: number;
  maxConnections?: number;
}

export class DatabaseManager {
  private sourcePool: Pool | null = null;
  private targetPool: Pool | null = null;

  constructor() {
    this.validateEnvironmentVariables();
  }

  /**
   * Initialize database connections
   */
  public async initialize(): Promise<void> {
    try {
      console.log('Initializing database connections...');

      // Initialize source database pool
      this.sourcePool = this.createPool(this.getSourceConfig());
      await this.testConnection(this.sourcePool, 'source');

      // Initialize target database pool
      this.targetPool = this.createPool(this.getTargetConfig());
      await this.testConnection(this.targetPool, 'target');

      // Verify migration tables exist
      await this.verifyMigrationTables();

      console.log('Database connections initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database connections:', error);
      throw error;
    }
  }

  /**
   * Get source database pool (legacy system)
   */
  public getSourcePool(): Pool {
    if (!this.sourcePool) {
      throw new Error('Source database pool not initialized. Call initialize() first.');
    }
    return this.sourcePool;
  }

  /**
   * Get target database pool (modern system)
   */
  public getTargetPool(): Pool {
    if (!this.targetPool) {
      throw new Error('Target database pool not initialized. Call initialize() first.');
    }
    return this.targetPool;
  }

  /**
   * Close all database connections
   */
  public async close(): Promise<void> {
    console.log('Closing database connections...');

    const promises: Promise<void>[] = [];

    if (this.sourcePool) {
      promises.push(this.sourcePool.end());
      this.sourcePool = null;
    }

    if (this.targetPool) {
      promises.push(this.targetPool.end());
      this.targetPool = null;
    }

    await Promise.all(promises);
    console.log('Database connections closed');
  }

  /**
   * Get database health status
   */
  public async getHealthStatus(): Promise<{
    source: { connected: boolean; error?: string; activeConnections?: number };
    target: { connected: boolean; error?: string; activeConnections?: number };
  }> {
    const result = {
      source: { connected: false },
      target: { connected: false }
    };

    // Check source database
    if (this.sourcePool) {
      try {
        const client = await this.sourcePool.connect();
        try {
          await client.query('SELECT 1');
          const connResult = await client.query(`
            SELECT count(*) as active_connections
            FROM pg_stat_activity
            WHERE state = 'active' AND datname = current_database()
          `);
          result.source = {
            connected: true,
            activeConnections: parseInt(connResult.rows[0].active_connections)
          };
        } finally {
          client.release();
        }
      } catch (error) {
        result.source = {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    // Check target database
    if (this.targetPool) {
      try {
        const client = await this.targetPool.connect();
        try {
          await client.query('SELECT 1');
          const connResult = await client.query(`
            SELECT count(*) as active_connections
            FROM pg_stat_activity
            WHERE state = 'active' AND datname = current_database()
          `);
          result.target = {
            connected: true,
            activeConnections: parseInt(connResult.rows[0].active_connections)
          };
        } finally {
          client.release();
        }
      } catch (error) {
        result.target = {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return result;
  }

  private validateEnvironmentVariables(): void {
    const requiredSourceVars = [
      'SOURCE_DB_HOST',
      'SOURCE_DB_PORT',
      'SOURCE_DB_NAME',
      'SOURCE_DB_USER',
      'SOURCE_DB_PASSWORD'
    ];

    const requiredTargetVars = [
      'TARGET_DB_HOST',
      'TARGET_DB_PORT',
      'TARGET_DB_NAME',
      'TARGET_DB_USER',
      'TARGET_DB_PASSWORD'
    ];

    const missingVars: string[] = [];

    [...requiredSourceVars, ...requiredTargetVars].forEach(varName => {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    });

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  private getSourceConfig(): DatabaseConfig {
    return {
      host: process.env.SOURCE_DB_HOST!,
      port: parseInt(process.env.SOURCE_DB_PORT!, 10),
      database: process.env.SOURCE_DB_NAME!,
      username: process.env.SOURCE_DB_USER!,
      password: process.env.SOURCE_DB_PASSWORD!,
      ssl: process.env.SOURCE_DB_SSL === 'true',
      connectionTimeout: parseInt(process.env.SOURCE_DB_TIMEOUT || '30000', 10),
      idleTimeout: parseInt(process.env.SOURCE_DB_IDLE_TIMEOUT || '10000', 10),
      maxConnections: parseInt(process.env.SOURCE_DB_MAX_CONNECTIONS || '10', 10)
    };
  }

  private getTargetConfig(): DatabaseConfig {
    return {
      host: process.env.TARGET_DB_HOST!,
      port: parseInt(process.env.TARGET_DB_PORT!, 10),
      database: process.env.TARGET_DB_NAME!,
      username: process.env.TARGET_DB_USER!,
      password: process.env.TARGET_DB_PASSWORD!,
      ssl: process.env.TARGET_DB_SSL === 'true',
      connectionTimeout: parseInt(process.env.TARGET_DB_TIMEOUT || '30000', 10),
      idleTimeout: parseInt(process.env.TARGET_DB_IDLE_TIMEOUT || '10000', 10),
      maxConnections: parseInt(process.env.TARGET_DB_MAX_CONNECTIONS || '20', 10)
    };
  }

  private createPool(config: DatabaseConfig): Pool {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: config.connectionTimeout || 30000,
      idleTimeoutMillis: config.idleTimeout || 10000,
      max: config.maxConnections || 10,
      min: 2, // Minimum connections to maintain
      acquireTimeoutMillis: 60000, // Max time to wait for connection
      createTimeoutMillis: 30000, // Max time to establish new connection
      destroyTimeoutMillis: 5000, // Max time to close connection
      reapIntervalMillis: 1000 // How often to check for idle connections
    };

    const pool = new Pool(poolConfig);

    // Set up error handling
    pool.on('error', (err: Error) => {
      console.error('Unexpected database pool error:', err);
    });

    pool.on('connect', (client: Client) => {
      console.log(`Database pool connected to ${config.host}:${config.port}/${config.database}`);
    });

    pool.on('acquire', () => {
      // console.log('Database connection acquired from pool');
    });

    pool.on('remove', () => {
      console.log('Database connection removed from pool');
    });

    return pool;
  }

  private async testConnection(pool: Pool, label: string): Promise<void> {
    const client = await pool.connect();

    try {
      const result = await client.query('SELECT version(), current_database(), current_user, NOW() as timestamp');
      const dbInfo = result.rows[0];

      console.log(`${label} database connection test successful:`);
      console.log(`  Database: ${dbInfo.current_database}`);
      console.log(`  User: ${dbInfo.current_user}`);
      console.log(`  Version: ${dbInfo.version.split(' ').slice(0, 2).join(' ')}`);
      console.log(`  Server Time: ${dbInfo.timestamp}`);

      // Test query performance
      const perfStart = Date.now();
      await client.query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = \'public\'');
      const perfTime = Date.now() - perfStart;

      console.log(`  Query Performance: ${perfTime}ms`);

      if (perfTime > 5000) {
        console.warn(`  Warning: ${label} database queries are slow (${perfTime}ms)`);
      }
    } finally {
      client.release();
    }
  }

  private async verifyMigrationTables(): Promise<void> {
    if (!this.targetPool) {
      throw new Error('Target database pool not initialized');
    }

    const client = await this.targetPool.connect();

    try {
      // Check for essential migration tables
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN (
          'migration_mappings',
          'migration_control',
          'migration_checkpoints',
          'data_differentials',
          'synchronization_jobs',
          'migration_validation_reports',
          'sync_run_history'
        )
        ORDER BY table_name
      `);

      const existingTables = tablesResult.rows.map(row => row.table_name);
      const requiredTables = [
        'migration_mappings',
        'migration_control'
      ];

      const missingRequired = requiredTables.filter(table => !existingTables.includes(table));

      if (missingRequired.length > 0) {
        console.warn(`Warning: Missing required migration tables: ${missingRequired.join(', ')}`);
        console.log('Consider running the migration schema setup scripts');
      } else {
        console.log('Migration tables verified successfully');
      }

      console.log(`Found migration tables: ${existingTables.join(', ')}`);

      // Check table record counts for monitoring
      for (const table of existingTables) {
        try {
          const countResult = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
          const count = parseInt(countResult.rows[0].count);
          console.log(`  ${table}: ${count.toLocaleString()} records`);
        } catch (error) {
          console.warn(`  ${table}: Could not get record count`);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Execute a transaction on the target database
   */
  public async executeTransaction<T>(
    callback: (client: Client) => Promise<T>
  ): Promise<T> {
    if (!this.targetPool) {
      throw new Error('Target database pool not initialized');
    }

    const client = await this.targetPool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
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
   * Get database statistics
   */
  public async getDatabaseStats(): Promise<{
    source: any;
    target: any;
  }> {
    const stats = {
      source: null as any,
      target: null as any
    };

    // Get source database stats
    if (this.sourcePool) {
      try {
        const client = await this.sourcePool.connect();
        try {
          const result = await client.query(`
            SELECT
              schemaname,
              tablename,
              n_tup_ins as inserts,
              n_tup_upd as updates,
              n_tup_del as deletes,
              n_live_tup as live_tuples,
              n_dead_tup as dead_tuples
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
            AND tablename LIKE 'dispatch_%'
            ORDER BY n_live_tup DESC
            LIMIT 10
          `);

          stats.source = {
            totalTables: result.rows.length,
            tables: result.rows
          };
        } finally {
          client.release();
        }
      } catch (error) {
        console.warn('Could not get source database stats:', error);
      }
    }

    // Get target database stats
    if (this.targetPool) {
      try {
        const client = await this.targetPool.connect();
        try {
          const result = await client.query(`
            SELECT
              schemaname,
              tablename,
              n_tup_ins as inserts,
              n_tup_upd as updates,
              n_tup_del as deletes,
              n_live_tup as live_tuples,
              n_dead_tup as dead_tuples
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
            ORDER BY n_live_tup DESC
            LIMIT 10
          `);

          stats.target = {
            totalTables: result.rows.length,
            tables: result.rows
          };
        } finally {
          client.release();
        }
      } catch (error) {
        console.warn('Could not get target database stats:', error);
      }
    }

    return stats;
  }
}

// Singleton instance
export const databaseManager = new DatabaseManager();