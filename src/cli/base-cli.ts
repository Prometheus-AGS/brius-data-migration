/**
 * Base CLI Framework
 *
 * Provides comprehensive CLI infrastructure for the database migration system.
 * Includes command parsing, validation, help system, progress reporting,
 * and integration with logging and error handling systems.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger, Logger, getErrorHandler, ErrorHandler, generateCorrelationId } from '../lib/error-handler';
import { getEventPublisher, EventPublisher } from '../lib/event-publisher';
import { getConfig, validateConfig } from '../lib/environment-config';

// ===== CLI TYPES AND INTERFACES =====

export interface CliArgument {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
  defaultValue?: any;
  choices?: string[];
  validator?: (value: any) => boolean | string;
}

export interface CliOption extends CliArgument {
  short?: string;
  long: string;
  flag?: boolean; // true for boolean flags like --verbose
}

export interface CliCommand {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  arguments?: CliArgument[];
  options?: CliOption[];
  subcommands?: CliCommand[];
  action?: (context: CliContext) => Promise<void>;
  hidden?: boolean; // Hide from help
}

export interface CliContext {
  command: CliCommand;
  args: Record<string, any>;
  options: Record<string, any>;
  rawArgs: string[];
  correlationId: string;
  startTime: Date;
  logger: Logger;
  errorHandler: ErrorHandler;
  eventPublisher: EventPublisher;
}

export interface CliConfig {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  globalOptions?: CliOption[];
  beforeAction?: (context: CliContext) => Promise<void>;
  afterAction?: (context: CliContext, result?: any, error?: Error) => Promise<void>;
  helpTemplate?: string;
  enableColors?: boolean;
  enableProgress?: boolean;
  exitOnError?: boolean;
}

// ===== OUTPUT FORMATTING =====

export enum OutputFormat {
  TABLE = 'table',
  JSON = 'json',
  YAML = 'yaml',
  CSV = 'csv',
  TEXT = 'text'
}

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  VERBOSE = 5
}

export interface ProgressOptions {
  total?: number;
  current?: number;
  message?: string;
  showPercentage?: boolean;
  showEta?: boolean;
  width?: number;
}

// ===== BASE CLI CLASS =====

export abstract class BaseCli {
  protected config: CliConfig;
  protected commands: Map<string, CliCommand> = new Map();
  protected globalOptions: CliOption[];
  protected logger: Logger;
  protected errorHandler: ErrorHandler;
  protected eventPublisher: EventPublisher;
  private currentProgress?: ProgressState;

  constructor(config: CliConfig) {
    this.config = config;
    this.logger = getLogger();
    this.errorHandler = getErrorHandler();
    this.eventPublisher = getEventPublisher();

    // Default global options
    this.globalOptions = [
      {
        name: 'help',
        short: 'h',
        long: '--help',
        description: 'Show help information',
        type: 'boolean',
        flag: true
      },
      {
        name: 'version',
        short: 'v',
        long: '--version',
        description: 'Show version information',
        type: 'boolean',
        flag: true
      },
      {
        name: 'verbose',
        long: '--verbose',
        description: 'Enable verbose output',
        type: 'boolean',
        flag: true
      },
      {
        name: 'quiet',
        short: 'q',
        long: '--quiet',
        description: 'Suppress non-error output',
        type: 'boolean',
        flag: true
      },
      {
        name: 'output',
        short: 'o',
        long: '--output',
        description: 'Output format',
        type: 'string',
        choices: Object.values(OutputFormat),
        defaultValue: OutputFormat.TEXT
      },
      {
        name: 'config',
        short: 'c',
        long: '--config',
        description: 'Configuration file path',
        type: 'string'
      },
      {
        name: 'dry-run',
        long: '--dry-run',
        description: 'Show what would be done without executing',
        type: 'boolean',
        flag: true
      },
      {
        name: 'force',
        short: 'f',
        long: '--force',
        description: 'Force operation without confirmation',
        type: 'boolean',
        flag: true
      },
      ...(config.globalOptions || [])
    ];
  }

  /**
   * Register a command
   */
  protected registerCommand(command: CliCommand): void {
    this.commands.set(command.name, command);
  }

  /**
   * Parse and execute CLI command
   */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      // Validate environment configuration
      validateConfig();

      const parseResult = this.parseArgs(args);
      const context: CliContext = {
        command: parseResult.command,
        args: parseResult.args,
        options: parseResult.options,
        rawArgs: args,
        correlationId,
        startTime: new Date(),
        logger: this.logger,
        errorHandler: this.errorHandler,
        eventPublisher: this.eventPublisher
      };

      // Handle special global options
      if (context.options.help) {
        this.showHelp(context.command);
        return;
      }

      if (context.options.version) {
        this.showVersion();
        return;
      }

      // Configure output based on options
      this.configureOutput(context.options);

      // Execute before action hook
      if (this.config.beforeAction) {
        await this.config.beforeAction(context);
      }

      // Execute command
      let result: any;
      let error: Error | undefined;

      try {
        this.logger.info(`Executing command: ${context.command.name}`, {
          command: context.command.name,
          args: context.args,
          options: this.sanitizeOptions(context.options)
        });

        if (!context.command.action) {
          throw new Error(`Command '${context.command.name}' has no action defined`);
        }

        result = await context.command.action(context);

        this.logger.info(`Command completed successfully: ${context.command.name}`, {
          command: context.command.name,
          duration_ms: Date.now() - context.startTime.getTime(),
          correlation_id: correlationId
        });

      } catch (err) {
        error = err as Error;
        const migrationError = await this.errorHandler.handleError(error, {
          command: context.command.name,
          args: context.args,
          options: this.sanitizeOptions(context.options)
        }, correlationId);

        this.error(`Command failed: ${migrationError.message}`);

        if (this.config.exitOnError !== false) {
          process.exit(1);
        }
        throw migrationError;
      }

      // Execute after action hook
      if (this.config.afterAction) {
        await this.config.afterAction(context, result, error);
      }

    } catch (error) {
      if (this.config.exitOnError !== false) {
        process.exit(1);
      }
      throw error;
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Parse command line arguments
   */
  private parseArgs(args: string[]): {
    command: CliCommand;
    args: Record<string, any>;
    options: Record<string, any>;
  } {
    if (args.length === 0) {
      return {
        command: this.getDefaultCommand(),
        args: {},
        options: this.parseOptions(args, this.globalOptions)
      };
    }

    const commandName = args[0];
    const command = this.commands.get(commandName);

    if (!command) {
      // Check if it's a global option
      if (commandName.startsWith('-')) {
        return {
          command: this.getDefaultCommand(),
          args: {},
          options: this.parseOptions(args, this.globalOptions)
        };
      }

      throw new Error(`Unknown command: ${commandName}`);
    }

    const commandArgs = args.slice(1);
    const parsedArgs = this.parseArguments(commandArgs, command.arguments || []);
    const parsedOptions = this.parseOptions(commandArgs, [
      ...this.globalOptions,
      ...(command.options || [])
    ]);

    return {
      command,
      args: parsedArgs,
      options: parsedOptions
    };
  }

  /**
   * Parse positional arguments
   */
  private parseArguments(args: string[], definitions: CliArgument[]): Record<string, any> {
    const result: Record<string, any> = {};
    let argIndex = 0;

    // Filter out options from args
    const positionalArgs = args.filter(arg => !arg.startsWith('-'));

    for (const definition of definitions) {
      if (argIndex < positionalArgs.length) {
        const value = this.convertValue(positionalArgs[argIndex], definition.type);
        const validationResult = this.validateValue(value, definition);

        if (validationResult !== true) {
          throw new Error(`Invalid value for argument '${definition.name}': ${validationResult}`);
        }

        result[definition.name] = value;
        argIndex++;
      } else if (definition.required) {
        throw new Error(`Missing required argument: ${definition.name}`);
      } else if (definition.defaultValue !== undefined) {
        result[definition.name] = definition.defaultValue;
      }
    }

    return result;
  }

  /**
   * Parse options (flags and named parameters)
   */
  private parseOptions(args: string[], definitions: CliOption[]): Record<string, any> {
    const result: Record<string, any> = {};
    const definitionMap = new Map<string, CliOption>();

    // Build lookup maps for short and long options
    definitions.forEach(def => {
      definitionMap.set(def.long, def);
      if (def.short) {
        definitionMap.set(`-${def.short}`, def);
      }
    });

    // Set default values
    definitions.forEach(def => {
      if (def.defaultValue !== undefined) {
        result[def.name] = def.defaultValue;
      }
    });

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (!arg.startsWith('-')) {
        continue; // Skip positional arguments
      }

      const definition = definitionMap.get(arg);
      if (!definition) {
        continue; // Skip unknown options (they might be for subcommands)
      }

      if (definition.flag) {
        result[definition.name] = true;
      } else {
        // Option expects a value
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          throw new Error(`Option '${arg}' requires a value`);
        }

        const value = this.convertValue(args[i + 1], definition.type);
        const validationResult = this.validateValue(value, definition);

        if (validationResult !== true) {
          throw new Error(`Invalid value for option '${arg}': ${validationResult}`);
        }

        result[definition.name] = value;
        i++; // Skip the value
      }
    }

    return result;
  }

  /**
   * Convert string value to appropriate type
   */
  private convertValue(value: string, type: string): any {
    switch (type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new Error(`Expected number but got: ${value}`);
        }
        return num;
      case 'boolean':
        return value.toLowerCase() === 'true' || value === '1';
      case 'array':
        return value.split(',').map(v => v.trim());
      case 'string':
      default:
        return value;
    }
  }

  /**
   * Validate argument/option value
   */
  private validateValue(value: any, definition: CliArgument): boolean | string {
    // Check choices
    if (definition.choices && !definition.choices.includes(value)) {
      return `Must be one of: ${definition.choices.join(', ')}`;
    }

    // Custom validator
    if (definition.validator) {
      return definition.validator(value);
    }

    return true;
  }

  /**
   * Get default command (typically help)
   */
  private getDefaultCommand(): CliCommand {
    return {
      name: 'help',
      description: 'Show help information',
      action: async (context) => {
        this.showHelp();
      }
    };
  }

  /**
   * Configure output based on options
   */
  private configureOutput(options: Record<string, any>): void {
    // Set log level based on verbose/quiet flags
    if (options.quiet) {
      // Suppress most output
    } else if (options.verbose) {
      // Enable verbose output
    }
  }

  /**
   * Sanitize options for logging (remove sensitive data)
   */
  private sanitizeOptions(options: Record<string, any>): Record<string, any> {
    const sanitized = { ...options };
    const sensitiveKeys = ['password', 'token', 'key', 'secret'];

    Object.keys(sanitized).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '***REDACTED***';
      }
    });

    return sanitized;
  }

  // ===== OUTPUT METHODS =====

  /**
   * Print info message
   */
  protected info(message: string, data?: any): void {
    if (data) {
      console.log(`ℹ️  ${message}`, data);
    } else {
      console.log(`ℹ️  ${message}`);
    }
  }

  /**
   * Print success message
   */
  protected success(message: string, data?: any): void {
    if (data) {
      console.log(`✅ ${message}`, data);
    } else {
      console.log(`✅ ${message}`);
    }
  }

  /**
   * Print warning message
   */
  protected warn(message: string, data?: any): void {
    if (data) {
      console.warn(`⚠️  ${message}`, data);
    } else {
      console.warn(`⚠️  ${message}`);
    }
  }

  /**
   * Print error message
   */
  protected error(message: string, error?: Error): void {
    if (error) {
      console.error(`❌ ${message}:`, error.message);
    } else {
      console.error(`❌ ${message}`);
    }
  }

  /**
   * Print data in specified format
   */
  protected printData(data: any, format: OutputFormat = OutputFormat.TEXT): void {
    switch (format) {
      case OutputFormat.JSON:
        console.log(JSON.stringify(data, null, 2));
        break;
      case OutputFormat.TABLE:
        if (Array.isArray(data)) {
          console.table(data);
        } else {
          console.table([data]);
        }
        break;
      case OutputFormat.CSV:
        this.printCsv(data);
        break;
      case OutputFormat.YAML:
        // Would need yaml library
        console.log('YAML format not implemented');
        break;
      case OutputFormat.TEXT:
      default:
        if (typeof data === 'object') {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(data);
        }
        break;
    }
  }

  /**
   * Print CSV format
   */
  private printCsv(data: any): void {
    if (!Array.isArray(data)) {
      data = [data];
    }

    if (data.length === 0) {
      return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);
    console.log(headers.join(','));

    // Print rows
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      });
      console.log(values.join(','));
    });
  }

  // ===== PROGRESS REPORTING =====

  private interface ProgressState {
    total: number;
    current: number;
    message: string;
    startTime: Date;
    lastUpdate: Date;
  }

  /**
   * Start progress reporting
   */
  protected startProgress(options: ProgressOptions): void {
    if (!this.config.enableProgress) {
      return;
    }

    this.currentProgress = {
      total: options.total || 100,
      current: options.current || 0,
      message: options.message || 'Processing...',
      startTime: new Date(),
      lastUpdate: new Date()
    };

    this.updateProgress(this.currentProgress.current, this.currentProgress.message);
  }

  /**
   * Update progress
   */
  protected updateProgress(current: number, message?: string): void {
    if (!this.currentProgress || !this.config.enableProgress) {
      return;
    }

    this.currentProgress.current = Math.min(current, this.currentProgress.total);
    if (message) {
      this.currentProgress.message = message;
    }
    this.currentProgress.lastUpdate = new Date();

    const percentage = Math.round((this.currentProgress.current / this.currentProgress.total) * 100);
    const elapsed = Date.now() - this.currentProgress.startTime.getTime();
    const rate = this.currentProgress.current / (elapsed / 1000);
    const eta = rate > 0 ? Math.round((this.currentProgress.total - this.currentProgress.current) / rate) : 0;

    // Simple progress bar
    const barWidth = 40;
    const filledWidth = Math.round((percentage / 100) * barWidth);
    const bar = '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth);

    process.stdout.write(
      `\r${this.currentProgress.message} [${bar}] ${percentage}% (${this.currentProgress.current}/${this.currentProgress.total}) ETA: ${eta}s`
    );
  }

  /**
   * Complete progress
   */
  protected completeProgress(message?: string): void {
    if (!this.currentProgress || !this.config.enableProgress) {
      return;
    }

    const finalMessage = message || 'Completed';
    const duration = Date.now() - this.currentProgress.startTime.getTime();

    process.stdout.write(`\r${finalMessage} ✅ (${Math.round(duration / 1000)}s)\n`);
    this.currentProgress = undefined;
  }

  // ===== INTERACTIVE PROMPTS =====

  /**
   * Ask yes/no question
   */
  protected async confirm(message: string, defaultValue: boolean = false): Promise<boolean> {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const defaultText = defaultValue ? '[Y/n]' : '[y/N]';
    const question = `${message} ${defaultText}: `;

    return new Promise(resolve => {
      rl.question(question, (answer: string) => {
        rl.close();

        if (!answer.trim()) {
          resolve(defaultValue);
        } else {
          resolve(answer.toLowerCase().startsWith('y'));
        }
      });
    });
  }

  /**
   * Ask for input with validation
   */
  protected async prompt(message: string, options?: {
    defaultValue?: string;
    validator?: (value: string) => boolean | string;
    hidden?: boolean;
  }): Promise<string> {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (options?.hidden) {
      // Hide input for passwords
      (rl as any).input.on('keypress', () => {
        const len = (rl as any).line.length;
        readline.moveCursor((rl as any).output, -len, 0);
        readline.clearLine((rl as any).output, 1);
        for (let i = 0; i < len; i++) {
          (rl as any).output.write('*');
        }
      });
    }

    const defaultText = options?.defaultValue ? ` (${options.defaultValue})` : '';
    const question = `${message}${defaultText}: `;

    return new Promise((resolve, reject) => {
      const askQuestion = () => {
        rl.question(question, (answer: string) => {
          const value = answer.trim() || options?.defaultValue || '';

          if (options?.validator) {
            const validation = options.validator(value);
            if (validation !== true) {
              console.log(`❌ ${validation}`);
              askQuestion(); // Ask again
              return;
            }
          }

          rl.close();
          resolve(value);
        });
      };

      askQuestion();
    });
  }

  // ===== HELP SYSTEM =====

  /**
   * Show help information
   */
  protected showHelp(command?: CliCommand): void {
    if (command && command.name !== 'help') {
      this.showCommandHelp(command);
    } else {
      this.showGeneralHelp();
    }
  }

  /**
   * Show general help
   */
  private showGeneralHelp(): void {
    console.log(`${this.config.name} v${this.config.version}`);
    if (this.config.description) {
      console.log(this.config.description);
    }

    console.log('\nUsage:');
    console.log(`  ${this.config.name} [command] [options]`);

    if (this.commands.size > 0) {
      console.log('\nCommands:');
      const commands = Array.from(this.commands.values())
        .filter(cmd => !cmd.hidden)
        .sort((a, b) => a.name.localeCompare(b.name));

      const maxNameLength = Math.max(...commands.map(cmd => cmd.name.length));

      commands.forEach(cmd => {
        const padding = ' '.repeat(maxNameLength - cmd.name.length + 2);
        console.log(`  ${cmd.name}${padding}${cmd.description}`);
      });
    }

    if (this.globalOptions.length > 0) {
      console.log('\nGlobal Options:');
      this.showOptions(this.globalOptions);
    }

    if (this.config.author) {
      console.log(`\nAuthor: ${this.config.author}`);
    }

    if (this.config.homepage) {
      console.log(`Homepage: ${this.config.homepage}`);
    }
  }

  /**
   * Show command-specific help
   */
  private showCommandHelp(command: CliCommand): void {
    console.log(`${this.config.name} ${command.name}`);
    console.log(command.description);

    if (command.usage) {
      console.log(`\nUsage: ${command.usage}`);
    }

    if (command.arguments && command.arguments.length > 0) {
      console.log('\nArguments:');
      this.showArguments(command.arguments);
    }

    if (command.options && command.options.length > 0) {
      console.log('\nOptions:');
      this.showOptions(command.options);
    }

    if (command.examples && command.examples.length > 0) {
      console.log('\nExamples:');
      command.examples.forEach(example => {
        console.log(`  ${example}`);
      });
    }

    if (command.subcommands && command.subcommands.length > 0) {
      console.log('\nSubcommands:');
      const maxNameLength = Math.max(...command.subcommands.map(cmd => cmd.name.length));

      command.subcommands.forEach(subcmd => {
        const padding = ' '.repeat(maxNameLength - subcmd.name.length + 2);
        console.log(`  ${subcmd.name}${padding}${subcmd.description}`);
      });
    }
  }

  /**
   * Show arguments help
   */
  private showArguments(arguments: CliArgument[]): void {
    const maxNameLength = Math.max(...arguments.map(arg => arg.name.length));

    arguments.forEach(arg => {
      const padding = ' '.repeat(maxNameLength - arg.name.length + 2);
      const required = arg.required ? ' (required)' : '';
      const defaultValue = arg.defaultValue !== undefined ? ` [default: ${arg.defaultValue}]` : '';
      const choices = arg.choices ? ` [choices: ${arg.choices.join(', ')}]` : '';

      console.log(`  ${arg.name}${padding}${arg.description}${required}${defaultValue}${choices}`);
    });
  }

  /**
   * Show options help
   */
  private showOptions(options: CliOption[]): void {
    const maxNameLength = Math.max(...options.map(opt => {
      const short = opt.short ? `-${opt.short}, ` : '';
      return (short + opt.long).length;
    }));

    options.forEach(opt => {
      const short = opt.short ? `-${opt.short}, ` : '    ';
      const full = short + opt.long;
      const padding = ' '.repeat(maxNameLength - full.length + 2);
      const defaultValue = opt.defaultValue !== undefined ? ` [default: ${opt.defaultValue}]` : '';
      const choices = opt.choices ? ` [choices: ${opt.choices.join(', ')}]` : '';

      console.log(`  ${full}${padding}${opt.description}${defaultValue}${choices}`);
    });
  }

  /**
   * Show version information
   */
  private showVersion(): void {
    console.log(`${this.config.name} v${this.config.version}`);
  }

  // ===== UTILITY METHODS =====

  /**
   * Check if file exists
   */
  protected fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Read file content
   */
  protected readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file '${filePath}': ${(error as Error).message}`);
    }
  }

  /**
   * Write file content
   */
  protected writeFile(filePath: string, content: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to write file '${filePath}': ${(error as Error).message}`);
    }
  }

  /**
   * Get current working directory
   */
  protected getCwd(): string {
    return process.cwd();
  }

  /**
   * Exit with code
   */
  protected exit(code: number = 0): void {
    process.exit(code);
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Create CLI application
 */
export function createCli(config: CliConfig): BaseCli {
  return new (class extends BaseCli {
    constructor() {
      super(config);
    }
  })();
}

/**
 * Validate CLI argument definition
 */
export function validateCliArgument(arg: CliArgument): string[] {
  const errors: string[] = [];

  if (!arg.name || arg.name.trim() === '') {
    errors.push('Argument name is required');
  }

  if (!arg.description || arg.description.trim() === '') {
    errors.push('Argument description is required');
  }

  if (!['string', 'number', 'boolean', 'array'].includes(arg.type)) {
    errors.push('Invalid argument type');
  }

  return errors;
}

/**
 * Validate CLI option definition
 */
export function validateCliOption(opt: CliOption): string[] {
  const errors = validateCliArgument(opt);

  if (!opt.long || !opt.long.startsWith('--')) {
    errors.push('Option long name must start with --');
  }

  if (opt.short && (!opt.short.match(/^[a-zA-Z]$/) || opt.short.length !== 1)) {
    errors.push('Option short name must be a single letter');
  }

  return errors;
}

/**
 * Parse command line like arguments from string
 */
export function parseArgsFromString(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        args.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}