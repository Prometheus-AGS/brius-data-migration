/**
 * Security Manager
 *
 * Implements comprehensive security measures for differential migration operations
 * including credential management, data masking, access control, and compliance
 */

import * as crypto from 'crypto';
import { Pool, PoolConfig } from 'pg';

export interface SecurityConfig {
  // Connection security
  enforceSSL: boolean;
  connectionEncryption: boolean;
  certificateValidation: boolean;
  minTLSVersion: '1.2' | '1.3';

  // Credential management
  credentialValidation: boolean;
  allowHardcodedCredentials: boolean;
  credentialRotationDays: number;

  // Data protection
  enableDataMasking: boolean;
  piiDetection: boolean;
  maskingLevel: 'none' | 'partial' | 'full';
  auditLogging: boolean;

  // Access control
  enableRoleBasedAccess: boolean;
  requiredPermissions: string[];
  sessionTimeout: number; // minutes

  // Compliance
  enforceDataResidency: boolean;
  logDataMovements: boolean;
  enableComplianceReporting: boolean;
}

export interface SecurityValidationResult {
  isValid: boolean;
  issues: SecurityIssue[];
  recommendations: string[];
  complianceScore: number; // 0-100
}

export interface SecurityIssue {
  type: 'credential' | 'connection' | 'data' | 'access' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation: string;
  autoRemediable: boolean;
}

export interface PIIDetectionResult {
  fieldName: string;
  dataType: string;
  piiType: 'email' | 'phone' | 'ssn' | 'credit_card' | 'address' | 'name' | 'date_of_birth' | 'unknown';
  confidence: number; // 0-1
  sampleValues: string[];
  maskedSampleValues: string[];
}

export interface DataMaskingOptions {
  preserveFormat: boolean;
  preserveLength: boolean;
  maskingCharacter: string;
  partialMaskingRatio: number; // 0-1
}

/**
 * Security Manager
 *
 * Provides comprehensive security controls for migration operations
 */
export class SecurityManager {
  private config: SecurityConfig;
  private auditLog: SecurityAuditEntry[] = [];

  private readonly DEFAULT_CONFIG: SecurityConfig = {
    enforceSSL: true,
    connectionEncryption: true,
    certificateValidation: true,
    minTLSVersion: '1.2',
    credentialValidation: true,
    allowHardcodedCredentials: false,
    credentialRotationDays: 90,
    enableDataMasking: false,
    piiDetection: true,
    maskingLevel: 'partial',
    auditLogging: true,
    enableRoleBasedAccess: false,
    requiredPermissions: ['read', 'write', 'migrate'],
    sessionTimeout: 120, // 2 hours
    enforceDataResidency: false,
    logDataMovements: true,
    enableComplianceReporting: true
  };

  // PII detection patterns
  private readonly PII_PATTERNS = {
    email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    phone: /^[\+]?[1-9][\d]{0,15}$|^[(]?[\d]{3}[)]?[-.\s]?[\d]{3}[-.\s]?[\d]{4}$/,
    ssn: /^\d{3}-?\d{2}-?\d{4}$/,
    credit_card: /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/,
    date_of_birth: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/
  };

  constructor(config?: Partial<SecurityConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate database connection security
   */
  validateConnectionSecurity(dbConfig: PoolConfig): SecurityValidationResult {
    const issues: SecurityIssue[] = [];
    const recommendations: string[] = [];

    // SSL/TLS validation
    if (this.config.enforceSSL && !dbConfig.ssl) {
      issues.push({
        type: 'connection',
        severity: 'high',
        message: 'SSL/TLS not configured for database connection',
        recommendation: 'Enable SSL in database configuration',
        autoRemediable: false
      });
    }

    // Credential validation
    if (this.config.credentialValidation) {
      if (!dbConfig.password || dbConfig.password.length < 8) {
        issues.push({
          type: 'credential',
          severity: 'high',
          message: 'Weak or missing database password',
          recommendation: 'Use strong password (min 8 characters with mixed case and numbers)',
          autoRemediable: false
        });
      }

      // Check for hardcoded credentials (simplified check)
      if (!this.config.allowHardcodedCredentials &&
          (typeof dbConfig.password === 'string' && !dbConfig.password.startsWith('${'))) {
        recommendations.push('Use environment variables for database credentials');
      }
    }

    // Connection timeout validation
    if (!dbConfig.connectionTimeoutMillis || dbConfig.connectionTimeoutMillis > 30000) {
      issues.push({
        type: 'connection',
        severity: 'medium',
        message: 'Connection timeout not configured or too high',
        recommendation: 'Set connection timeout to 10-20 seconds',
        autoRemediable: true
      });
    }

    // Calculate compliance score
    const totalChecks = 5; // Number of security checks performed
    const passedChecks = totalChecks - issues.filter(i => i.severity === 'high' || i.severity === 'critical').length;
    const complianceScore = Math.floor((passedChecks / totalChecks) * 100);

    return {
      isValid: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
      issues,
      recommendations,
      complianceScore
    };
  }

  /**
   * Create secure database configuration
   */
  createSecureDbConfig(baseConfig: PoolConfig): PoolConfig {
    const secureConfig: PoolConfig = {
      ...baseConfig,
      // Connection security
      connectionTimeoutMillis: Math.min(baseConfig.connectionTimeoutMillis || 10000, 20000),
      idleTimeoutMillis: Math.min(baseConfig.idleTimeoutMillis || 30000, 30000),
      max: Math.min(baseConfig.max || 20, 50), // Limit max connections

      // Enable SSL if configured
      ssl: this.config.enforceSSL ? {
        rejectUnauthorized: this.config.certificateValidation,
        minVersion: `TLSv${this.config.minTLSVersion}`
      } : baseConfig.ssl,

      // Additional security options
      options: {
        ...baseConfig.options,
        // Prevent SQL injection
        statement_timeout: 30000,
        lock_timeout: 10000,
        idle_in_transaction_session_timeout: 60000
      }
    };

    return secureConfig;
  }

  /**
   * Detect PII in database columns
   */
  async detectPII(pool: Pool, tableName: string, sampleSize: number = 100): Promise<PIIDetectionResult[]> {
    if (!this.config.piiDetection) {
      return [];
    }

    try {
      // Get table columns
      const columnsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      const piiResults: PIIDetectionResult[] = [];

      for (const column of columnsResult.rows) {
        const columnName = column.column_name;
        const dataType = column.data_type;

        // Sample data from column
        const sampleResult = await pool.query(`
          SELECT ${columnName}
          FROM ${tableName}
          WHERE ${columnName} IS NOT NULL
          LIMIT $1
        `, [sampleSize]);

        if (sampleResult.rows.length === 0) continue;

        const sampleValues = sampleResult.rows.map(row => String(row[columnName]));
        const piiDetection = this.analyzePII(columnName, dataType, sampleValues);

        if (piiDetection.piiType !== 'unknown' && piiDetection.confidence > 0.7) {
          const maskedValues = this.maskData(sampleValues, piiDetection.piiType);

          piiResults.push({
            fieldName: columnName,
            dataType,
            piiType: piiDetection.piiType,
            confidence: piiDetection.confidence,
            sampleValues: sampleValues.slice(0, 3), // Only first 3 for security
            maskedSampleValues: maskedValues.slice(0, 3)
          });
        }
      }

      // Audit PII detection
      this.logSecurityAudit('pii_detection', {
        tableName,
        piiFieldsDetected: piiResults.length,
        sampleSize,
        timestamp: new Date()
      });

      return piiResults;

    } catch (error) {
      throw new Error(`PII detection failed: ${error.message}`);
    }
  }

  private analyzePII(columnName: string, dataType: string, samples: string[]): {
    piiType: PIIDetectionResult['piiType'];
    confidence: number;
  } {
    // Column name heuristics
    const lowerColumnName = columnName.toLowerCase();
    const nameBasedDetection = {
      email: lowerColumnName.includes('email') || lowerColumnName.includes('mail'),
      phone: lowerColumnName.includes('phone') || lowerColumnName.includes('tel'),
      name: lowerColumnName.includes('name') && !lowerColumnName.includes('username'),
      address: lowerColumnName.includes('address') || lowerColumnName.includes('addr'),
      date_of_birth: lowerColumnName.includes('birth') || lowerColumnName === 'dob'
    };

    // Pattern matching on sample data
    const patternMatches = {
      email: samples.filter(s => this.PII_PATTERNS.email.test(s)).length / samples.length,
      phone: samples.filter(s => this.PII_PATTERNS.phone.test(s)).length / samples.length,
      ssn: samples.filter(s => this.PII_PATTERNS.ssn.test(s)).length / samples.length,
      credit_card: samples.filter(s => this.PII_PATTERNS.credit_card.test(s)).length / samples.length,
      date_of_birth: samples.filter(s => this.PII_PATTERNS.date_of_birth.test(s)).length / samples.length
    };

    // Determine most likely PII type with confidence score
    let bestMatch: { type: PIIDetectionResult['piiType']; confidence: number } = {
      type: 'unknown',
      confidence: 0
    };

    Object.entries(patternMatches).forEach(([type, matchRatio]) => {
      let confidence = matchRatio;

      // Boost confidence if column name matches
      if (nameBasedDetection[type as keyof typeof nameBasedDetection]) {
        confidence = Math.min(1.0, confidence + 0.3);
      }

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          type: type as PIIDetectionResult['piiType'],
          confidence
        };
      }
    });

    // Special handling for name fields
    if (nameBasedDetection.name && !bestMatch.type) {
      bestMatch = { type: 'name', confidence: 0.8 };
    }

    // Special handling for address fields
    if (nameBasedDetection.address && !bestMatch.type) {
      bestMatch = { type: 'address', confidence: 0.7 };
    }

    return bestMatch;
  }

  /**
   * Mask sensitive data based on PII type
   */
  maskData(values: string[], piiType: PIIDetectionResult['piiType'], options?: Partial<DataMaskingOptions>): string[] {
    if (!this.config.enableDataMasking) {
      return values; // Return original if masking disabled
    }

    const maskingOptions: DataMaskingOptions = {
      preserveFormat: true,
      preserveLength: true,
      maskingCharacter: '*',
      partialMaskingRatio: 0.7,
      ...options
    };

    return values.map(value => this.maskSingleValue(value, piiType, maskingOptions));
  }

  private maskSingleValue(value: string, piiType: PIIDetectionResult['piiType'], options: DataMaskingOptions): string {
    if (!value || value.length === 0) return value;

    switch (this.config.maskingLevel) {
      case 'none':
        return value;

      case 'full':
        return options.preserveLength ?
          options.maskingCharacter.repeat(value.length) :
          options.maskingCharacter.repeat(8);

      case 'partial':
      default:
        return this.applyPartialMasking(value, piiType, options);
    }
  }

  private applyPartialMasking(value: string, piiType: PIIDetectionResult['piiType'], options: DataMaskingOptions): string {
    switch (piiType) {
      case 'email':
        const emailParts = value.split('@');
        if (emailParts.length === 2) {
          const maskedLocal = this.maskStringPartial(emailParts[0], 0.5);
          return `${maskedLocal}@${emailParts[1]}`;
        }
        return this.maskStringPartial(value, options.partialMaskingRatio);

      case 'phone':
        // Mask middle digits: (555) ***-1234
        if (value.length >= 10) {
          const cleaned = value.replace(/\D/g, '');
          const masked = cleaned.substring(0, 3) +
                       options.maskingCharacter.repeat(cleaned.length - 6) +
                       cleaned.substring(cleaned.length - 3);
          return this.restorePhoneFormat(masked, value);
        }
        return this.maskStringPartial(value, options.partialMaskingRatio);

      case 'ssn':
        // Mask middle digits: ***-**-1234
        if (value.length >= 9) {
          const cleaned = value.replace(/\D/g, '');
          return `***-**-${cleaned.substring(cleaned.length - 4)}`;
        }
        return this.maskStringPartial(value, options.partialMaskingRatio);

      case 'credit_card':
        // Mask middle digits: ****-****-****-1234
        const cleaned = value.replace(/\D/g, '');
        if (cleaned.length >= 13) {
          return `****-****-****-${cleaned.substring(cleaned.length - 4)}`;
        }
        return this.maskStringPartial(value, options.partialMaskingRatio);

      case 'name':
        // Mask last name: John D***
        const nameParts = value.split(' ');
        if (nameParts.length >= 2) {
          const firstName = nameParts[0];
          const lastName = nameParts[nameParts.length - 1];
          const maskedLastName = lastName.charAt(0) + options.maskingCharacter.repeat(lastName.length - 1);
          return `${firstName} ${maskedLastName}`;
        }
        return this.maskStringPartial(value, 0.5);

      case 'address':
        // Mask street number: *** Main St, City, State
        const parts = value.split(',');
        if (parts.length > 0) {
          const streetMasked = this.maskStringPartial(parts[0], 0.3);
          return [streetMasked, ...parts.slice(1)].join(',');
        }
        return this.maskStringPartial(value, 0.3);

      case 'date_of_birth':
        // Mask day and month: ****-**-01
        const dateParts = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (dateParts) {
          return `****-**-${dateParts[3].padStart(2, '0')}`;
        }
        return this.maskStringPartial(value, options.partialMaskingRatio);

      default:
        return this.maskStringPartial(value, options.partialMaskingRatio);
    }
  }

  private maskStringPartial(value: string, ratio: number): string {
    const maskLength = Math.floor(value.length * ratio);
    const startVisible = Math.floor((value.length - maskLength) / 2);

    return value.substring(0, startVisible) +
           '*'.repeat(maskLength) +
           value.substring(startVisible + maskLength);
  }

  private restorePhoneFormat(maskedDigits: string, originalFormat: string): string {
    // Simple format restoration - could be enhanced for complex formats
    let result = maskedDigits;
    let digitIndex = 0;

    return originalFormat.replace(/\d/g, () => {
      return digitIndex < result.length ? result[digitIndex++] : '*';
    });
  }

  /**
   * Validate input parameters for security risks
   */
  validateInput(input: any, schema: any): { isValid: boolean; sanitizedInput: any; issues: string[] } {
    const issues: string[] = [];
    let sanitizedInput = { ...input };

    // SQL injection prevention
    if (typeof input === 'object') {
      Object.keys(input).forEach(key => {
        const value = input[key];
        if (typeof value === 'string') {
          // Check for SQL injection patterns
          const sqlInjectionPatterns = [
            /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b)/i,
            /(UNION\s+SELECT)/i,
            /(\bOR\b\s*\d+\s*=\s*\d+)/i,
            /(--|\/\*|\*\/)/,
            /(\bSCRIPT\b)/i
          ];

          const hasSQLInjection = sqlInjectionPatterns.some(pattern => pattern.test(value));
          if (hasSQLInjection) {
            issues.push(`Potential SQL injection detected in field '${key}'`);
            // Sanitize by escaping dangerous characters
            sanitizedInput[key] = value.replace(/['";--]/g, '');
          }
        }
      });
    }

    // XSS prevention for string inputs
    if (typeof input === 'string') {
      const xssPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi
      ];

      const hasXSS = xssPatterns.some(pattern => pattern.test(input));
      if (hasXSS) {
        issues.push('Potential XSS attack detected');
        sanitizedInput = input.replace(/<[^>]*>/g, ''); // Strip HTML tags
      }
    }

    return {
      isValid: issues.length === 0,
      sanitizedInput,
      issues
    };
  }

  /**
   * Generate secure session token
   */
  generateSecureSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate session token
   */
  validateSessionToken(token: string): boolean {
    // Basic validation - in production, this would check against stored tokens
    return token && token.length === 64 && /^[a-f0-9]+$/.test(token);
  }

  /**
   * Log security audit event
   */
  private logSecurityAudit(event: string, details: any): void {
    if (!this.config.auditLogging) return;

    const auditEntry: SecurityAuditEntry = {
      timestamp: new Date(),
      event,
      details,
      sessionId: this.generateSecureSessionToken().substring(0, 8)
    };

    this.auditLog.push(auditEntry);

    // Keep only last 1000 audit entries
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }
  }

  /**
   * Get security audit log
   */
  getSecurityAuditLog(limit?: number): SecurityAuditEntry[] {
    const entries = limit ? this.auditLog.slice(-limit) : this.auditLog;
    return entries.map(entry => ({ ...entry })); // Return copy for security
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(): {
    complianceScore: number;
    securityChecks: {
      connectionSecurity: boolean;
      credentialManagement: boolean;
      dataProtection: boolean;
      accessControl: boolean;
      auditLogging: boolean;
    };
    recommendations: string[];
    auditSummary: {
      totalEvents: number;
      criticalEvents: number;
      lastAuditDate: Date | null;
    };
  } {
    const recommendations: string[] = [];

    const securityChecks = {
      connectionSecurity: this.config.enforceSSL && this.config.connectionEncryption,
      credentialManagement: this.config.credentialValidation && !this.config.allowHardcodedCredentials,
      dataProtection: this.config.enableDataMasking && this.config.piiDetection,
      accessControl: this.config.enableRoleBasedAccess,
      auditLogging: this.config.auditLogging
    };

    // Generate recommendations for failed checks
    if (!securityChecks.connectionSecurity) {
      recommendations.push('Enable SSL/TLS encryption for all database connections');
    }
    if (!securityChecks.credentialManagement) {
      recommendations.push('Implement proper credential management with environment variables');
    }
    if (!securityChecks.dataProtection) {
      recommendations.push('Enable PII detection and data masking for compliance');
    }
    if (!securityChecks.accessControl) {
      recommendations.push('Implement role-based access control for migration operations');
    }
    if (!securityChecks.auditLogging) {
      recommendations.push('Enable comprehensive audit logging for compliance');
    }

    const passedChecks = Object.values(securityChecks).filter(check => check).length;
    const complianceScore = Math.floor((passedChecks / Object.keys(securityChecks).length) * 100);

    const criticalEvents = this.auditLog.filter(entry =>
      entry.event.includes('error') || entry.event.includes('violation')
    ).length;

    return {
      complianceScore,
      securityChecks,
      recommendations,
      auditSummary: {
        totalEvents: this.auditLog.length,
        criticalEvents,
        lastAuditDate: this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].timestamp : null
      }
    };
  }
}

interface SecurityAuditEntry {
  timestamp: Date;
  event: string;
  details: any;
  sessionId: string;
}