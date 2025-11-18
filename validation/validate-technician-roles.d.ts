/**
 * T020: Technician roles validation script
 * Comprehensive validation for migrated technician role records
 */
import { ValidationResult } from '../src/interfaces/migration-types';
export declare class TechnicianRolesValidator {
    private connectionManager;
    private validator;
    private reportGenerator;
    constructor();
    validate(): Promise<ValidationResult>;
    private validateCompleteness;
    private validateForeignKeys;
    private validateDataIntegrity;
    private validateBusinessRules;
    private validateRoleSpecificRules;
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
        roleDistribution: {
            [roleType: string]: number;
        };
        scopeDistribution: {
            [scopeType: string]: number;
        };
    }>;
}
declare function main(): Promise<void>;
export { main as validateTechnicianRoles };
//# sourceMappingURL=validate-technician-roles.d.ts.map