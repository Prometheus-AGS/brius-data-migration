/**
 * Environment Configuration Management
 *
 * Centralizes environment variable handling for the full database migration system.
 * Provides type-safe access to configuration with validation and default values.
 */

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  max?: number; // Maximum pool size
}

/**
 * Migration-specific configuration
 */
export interface MigrationConfig {
  batchSize: number;
  maxRetryAttempts: number;
  migrationTimeout: number;
  maxParallelEntities: number;
  memoryLimitMB: number;
  checkpointFrequency: number;
  enableRollback: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  source: DatabaseConfig;
  destination: DatabaseConfig;
  migration: MigrationConfig;
  supabase: {
    url: string;
    serviceRoleKey: string;
    apiUrl: string;
  };
  environment: 'development' | 'staging' | 'production' | 'test';
  logging: {
    level: string;
    enableFileLogging: boolean;
    logDirectory: string;
  };
  monitoring: {
    enableMetrics: boolean;
    metricsPort: number;
    enableHealthCheck: boolean;
  };
}

/**
 * Validates required environment variables and returns typed configuration
 */
function createConfig(): AppConfig {
  // Validate required environment variables
  const requiredVars = [
    'SOURCE_DB_HOST',
    'SOURCE_DB_PASSWORD',
    'SOURCE_DB_NAME',
    'TARGET_DB_HOST',
    'TARGET_DB_PASSWORD',
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n` +
      'Please ensure all required variables are set in your .env file.'
    );
  }

  return {
    source: {
      host: process.env.SOURCE_DB_HOST!,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME!,
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD!,
      ssl: process.env.SOURCE_DB_SSL === 'true',
      connectionTimeoutMillis: parseInt(process.env.SOURCE_DB_TIMEOUT || '30000'),
      idleTimeoutMillis: parseInt(process.env.SOURCE_DB_IDLE_TIMEOUT || '10000'),
      max: parseInt(process.env.SOURCE_DB_POOL_SIZE || '10'),
    },

    destination: {
      host: process.env.TARGET_DB_HOST!,
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'supabase_admin',
      password: process.env.TARGET_DB_PASSWORD!,
      ssl: process.env.TARGET_DB_SSL === 'true',
      connectionTimeoutMillis: parseInt(process.env.TARGET_DB_TIMEOUT || '30000'),
      idleTimeoutMillis: parseInt(process.env.TARGET_DB_IDLE_TIMEOUT || '10000'),
      max: parseInt(process.env.TARGET_DB_POOL_SIZE || '10'),
    },

    migration: {
      batchSize: parseInt(process.env.BATCH_SIZE || '1000'),
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
      migrationTimeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
      maxParallelEntities: parseInt(process.env.MAX_PARALLEL_ENTITIES || '4'),
      memoryLimitMB: parseInt(process.env.MEMORY_LIMIT_MB || '512'),
      checkpointFrequency: parseInt(process.env.CHECKPOINT_FREQUENCY || '1000'),
      enableRollback: process.env.ENABLE_ROLLBACK !== 'false',
      logLevel: (process.env.LOG_LEVEL as any) || 'info',
    },

    supabase: {
      url: process.env.SUPABASE_URL || 'http://localhost:8000',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE || '',
      apiUrl: process.env.SUPABASE_API_URL || 'http://localhost:8000/rest/v1',
    },

    environment: (process.env.NODE_ENV as any) || 'development',

    logging: {
      level: process.env.LOG_LEVEL || 'info',
      enableFileLogging: process.env.ENABLE_FILE_LOGGING !== 'false',
      logDirectory: process.env.LOG_DIRECTORY || './logs',
    },

    monitoring: {
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
      enableHealthCheck: process.env.ENABLE_HEALTH_CHECK !== 'false',
    },
  };
}

// Export the configuration instance
let config: AppConfig | null = null;

/**
 * Gets the application configuration, creating it if it doesn't exist
 */
export function getConfig(): AppConfig {
  if (!config) {
    config = createConfig();
  }
  return config;
}

/**
 * Validates the current configuration and throws descriptive errors for issues
 */
export function validateConfig(): void {
  const cfg = getConfig();

  // Validate database configurations
  if (cfg.source.port < 1 || cfg.source.port > 65535) {
    throw new Error(`Invalid source database port: ${cfg.source.port}`);
  }

  if (cfg.destination.port < 1 || cfg.destination.port > 65535) {
    throw new Error(`Invalid destination database port: ${cfg.destination.port}`);
  }

  // Validate migration parameters
  if (cfg.migration.batchSize < 1 || cfg.migration.batchSize > 10000) {
    throw new Error(`Invalid batch size: ${cfg.migration.batchSize}. Must be between 1 and 10000.`);
  }

  if (cfg.migration.maxParallelEntities < 1 || cfg.migration.maxParallelEntities > 20) {
    throw new Error(
      `Invalid max parallel entities: ${cfg.migration.maxParallelEntities}. Must be between 1 and 20.`
    );
  }

  if (cfg.migration.memoryLimitMB < 128 || cfg.migration.memoryLimitMB > 4096) {
    throw new Error(
      `Invalid memory limit: ${cfg.migration.memoryLimitMB}MB. Must be between 128 and 4096.`
    );
  }

  // Validate log level
  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(cfg.migration.logLevel)) {
    throw new Error(
      `Invalid log level: ${cfg.migration.logLevel}. Must be one of: ${validLogLevels.join(', ')}`
    );
  }

  // Validate environment
  const validEnvironments = ['development', 'staging', 'production', 'test'];
  if (!validEnvironments.includes(cfg.environment)) {
    throw new Error(
      `Invalid environment: ${cfg.environment}. Must be one of: ${validEnvironments.join(', ')}`
    );
  }
}

/**
 * Returns a safe configuration object for logging (with sensitive data masked)
 */
export function getConfigForLogging(): any {
  const cfg = getConfig();
  return {
    source: {
      ...cfg.source,
      password: '***masked***',
    },
    destination: {
      ...cfg.destination,
      password: '***masked***',
    },
    migration: cfg.migration,
    supabase: {
      ...cfg.supabase,
      serviceRoleKey: cfg.supabase.serviceRoleKey ? '***masked***' : '',
    },
    environment: cfg.environment,
    logging: cfg.logging,
    monitoring: cfg.monitoring,
  };
}

/**
 * Checks if we're running in a specific environment
 */
export function isEnvironment(env: 'development' | 'staging' | 'production' | 'test'): boolean {
  return getConfig().environment === env;
}

/**
 * Utility functions for common configuration checks
 */
export const configUtils = {
  isProduction: () => isEnvironment('production'),
  isDevelopment: () => isEnvironment('development'),
  isTesting: () => isEnvironment('test'),

  shouldEnableDebugLogging: () => {
    const cfg = getConfig();
    return cfg.migration.logLevel === 'debug' || cfg.environment === 'development';
  },

  shouldEnableFileLogging: () => getConfig().logging.enableFileLogging,

  shouldEnableMetrics: () => getConfig().monitoring.enableMetrics,

  getConnectionString: (type: 'source' | 'destination') => {
    const dbConfig = type === 'source' ? getConfig().source : getConfig().destination;
    return `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
  },

  getMaskedConnectionString: (type: 'source' | 'destination') => {
    const dbConfig = type === 'source' ? getConfig().source : getConfig().destination;
    return `postgresql://${dbConfig.user}:***@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
  },
};

// Initialize and validate configuration on module load
try {
  validateConfig();
} catch (error) {
  console.error('❌ Configuration validation failed:', (error as Error).message);
  if (process.env.NODE_ENV !== 'test') {
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
}