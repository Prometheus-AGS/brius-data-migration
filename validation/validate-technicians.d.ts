/**
 * T018: Technicians validation script
 * Comprehensive validation for migrated technician records
 */
import { ValidationResult } from '../src/interfaces/migration-types';
export declare class TechniciansValidator {
    private connectionManager;
    private validator;
    private reportGenerator;
    constructor();
    validate(): Promise<ValidationResult>;
    private validateCompleteness;
    private validateForeignKeys;
    private validateDataIntegrity;
    private validateBusinessRules;
    private combineValidationResults;
    private generateValidationReport;
    getValidationSummary(): Promise<{
        totalRecords: number;
        validRecords: number;
        issues: {
            errors: number;
            warnings: number;
            info: number;
        };
        status: 'passed' | 'failed';
    }>;
}
declare function main(): Promise<void>;
export { main as validateTechnicians };
//# sourceMappingURL=validate-technicians.d.ts.map