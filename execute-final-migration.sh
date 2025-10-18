#!/bin/bash

###############################################################################
# T031: Automated execution script for final migration phase
# Executes final migration plan by processing and executing all tasks
###############################################################################

set -euo pipefail  # Exit on any error, undefined vars, or pipe failures

# Script metadata
SCRIPT_NAME="Final Migration Execution"
SCRIPT_VERSION="1.0.0"
EXECUTION_DATE=$(date '+%Y-%m-%d %H:%M:%S')
LOG_DIR="/usr/local/src/sage/dataload/logs"
REPORT_DIR="/usr/local/src/sage/dataload"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Main log file
MAIN_LOG="$LOG_DIR/final-migration-$(date '+%Y%m%d-%H%M%S').log"

###############################################################################
# Utility Functions
###############################################################################

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    echo -e "[$timestamp] [$level] $message" | tee -a "$MAIN_LOG"
}

log_info() {
    log "INFO" "${BLUE}$*${NC}"
}

log_success() {
    log "SUCCESS" "${GREEN}$*${NC}"
}

log_warning() {
    log "WARNING" "${YELLOW}$*${NC}"
}

log_error() {
    log "ERROR" "${RED}$*${NC}"
}

log_step() {
    log "STEP" "${PURPLE}$*${NC}"
}

print_banner() {
    echo -e "${CYAN}"
    echo "###############################################################################"
    echo "#                                                                             #"
    echo "#                    🚀 FINAL DATABASE MIGRATION PHASE                      #"
    echo "#                                                                             #"
    echo "#  Migrating remaining 9 tables from legacy system to Supabase              #"
    echo "#  Tables: technicians, technician_roles, message_attachments,              #"
    echo "#          template_view_groups, template_view_roles, treatment_discussions, #"
    echo "#          brackets, order_cases, purchases                                  #"
    echo "#                                                                             #"
    echo "###############################################################################"
    echo -e "${NC}"
}

check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed or not in PATH"
        exit 1
    fi

    # Check if TypeScript is available
    if ! command -v npx &> /dev/null; then
        log_error "npx is not available - ensure Node.js and npm are properly installed"
        exit 1
    fi

    # Check if .env file exists
    if [[ ! -f ".env" ]]; then
        log_error ".env file not found - database configuration required"
        exit 1
    fi

    # Check if package.json exists
    if [[ ! -f "package.json" ]]; then
        log_error "package.json not found - run from project root directory"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

test_database_connectivity() {
    log_step "Testing database connectivity..."

    # Test connections using the connection manager
    if npx ts-node -e "
        import { DatabaseConnectionManager } from './src/database/connection-manager';
        async function test() {
            const manager = DatabaseConnectionManager.fromEnvironment();
            await manager.initializeClients();
            const health = await manager.healthCheck();
            if (health.status !== 'healthy') {
                console.error('Database connectivity failed:', health);
                process.exit(1);
            }
            console.log('✅ Database connectivity verified');
            await manager.closeAll();
        }
        test().catch(console.error);
    "; then
        log_success "Database connectivity verified"
    else
        log_error "Database connectivity test failed"
        exit 1
    fi
}

execute_migration_script() {
    local script_name="$1"
    local description="$2"

    log_step "Executing: $description"

    local script_log="$LOG_DIR/${script_name}-$(date '+%Y%m%d-%H%M%S').log"

    if npx ts-node "src/$script_name.ts" 2>&1 | tee "$script_log"; then
        log_success "$description completed successfully"
        return 0
    else
        log_error "$description failed - check $script_log for details"
        return 1
    fi
}

execute_validation_script() {
    local script_name="$1"
    local description="$2"

    log_step "Validating: $description"

    local script_log="$LOG_DIR/${script_name}-$(date '+%Y%m%d-%H%M%S').log"

    if npx ts-node "validation/$script_name.ts" 2>&1 | tee "$script_log"; then
        log_success "$description validation passed"
        return 0
    else
        log_error "$description validation failed - check $script_log for details"
        return 1
    fi
}

generate_progress_report() {
    local phase="$1"
    log_info "=== PROGRESS REPORT: $phase ==="
    log_info "Execution time: $(date '+%Y-%m-%d %H:%M:%S')"
    log_info "Logs directory: $LOG_DIR"
    log_info "Reports directory: $REPORT_DIR"
    echo ""
}

###############################################################################
# Migration Execution Functions
###############################################################################

execute_user_story_2() {
    log_step "🏢 Executing User Story 2: Personnel Tables"

    local success=true

    # T017: Technicians migration
    if ! execute_migration_script "migrate-technicians" "Technicians Migration"; then
        success=false
    fi

    # T018: Technicians validation
    if ! execute_validation_script "validate-technicians" "Technicians Validation"; then
        success=false
    fi

    # T019: Technician roles migration (depends on technicians)
    if [[ "$success" == "true" ]]; then
        if ! execute_migration_script "migrate-technician-roles" "Technician Roles Migration"; then
            success=false
        fi
    else
        log_warning "Skipping technician roles migration due to technicians migration failure"
    fi

    # T020: Technician roles validation
    if [[ "$success" == "true" ]]; then
        if ! execute_validation_script "validate-technician-roles" "Technician Roles Validation"; then
            success=false
        fi
    else
        log_warning "Skipping technician roles validation due to previous failures"
    fi

    if [[ "$success" == "true" ]]; then
        log_success "✅ User Story 2: Personnel Tables completed successfully"
    else
        log_error "❌ User Story 2: Personnel Tables completed with errors"
    fi

    generate_progress_report "User Story 2 - Personnel Tables"
    return $([ "$success" == "true" ] && echo 0 || echo 1)
}

execute_user_story_1() {
    log_step "📎 Executing User Story 1: Message Attachments"

    local success=true

    # T027: Message attachments migration
    if ! execute_migration_script "migrate-message-attachments" "Message Attachments Migration"; then
        success=false
    fi

    # T028: Message attachments validation
    if ! execute_validation_script "validate-message-attachments" "Message Attachments Validation"; then
        success=false
    fi

    if [[ "$success" == "true" ]]; then
        log_success "✅ User Story 1: Message Attachments completed successfully"
    else
        log_error "❌ User Story 1: Message Attachments completed with errors"
    fi

    generate_progress_report "User Story 1 - Message Attachments"
    return $([ "$success" == "true" ] && echo 0 || echo 1)
}

execute_user_story_3() {
    log_step "📋 Executing User Story 3: Template Management"

    local success=true

    log_warning "Template management migrations are placeholders - implement T011-T016"
    log_info "This would include:"
    log_info "  - T011: template_view_groups migration"
    log_info "  - T012: template_view_groups validation"
    log_info "  - T013: template_view_roles migration"
    log_info "  - T014: template_view_roles validation"
    log_info "  - T015: treatment_discussions migration"
    log_info "  - T016: treatment_discussions validation"

    # For now, mark as partial completion
    log_warning "⚠️ User Story 3: Template Management - Implementation pending"

    generate_progress_report "User Story 3 - Template Management"
    return 1  # Return failure to indicate incomplete implementation
}

execute_user_story_4() {
    log_step "📊 Executing User Story 4: Operational Data"

    local success=true

    log_warning "Operational data migrations are placeholders - implement T021-T026"
    log_info "This would include:"
    log_info "  - T021: brackets migration"
    log_info "  - T022: brackets validation"
    log_info "  - T023: order_cases migration"
    log_info "  - T024: order_cases validation"
    log_info "  - T025: purchases migration"
    log_info "  - T026: purchases validation"

    # For now, mark as partial completion
    log_warning "⚠️ User Story 4: Operational Data - Implementation pending"

    generate_progress_report "User Story 4 - Operational Data"
    return 1  # Return failure to indicate incomplete implementation
}

execute_user_story_5() {
    log_step "📋 Executing User Story 5: Final Report Generation"

    local success=true

    # T029: Final system validation
    if ! execute_validation_script "final-system-validation" "Final System Validation"; then
        success=false
    fi

    # T030: Comprehensive final report generation
    if ! execute_migration_script "generate-final-report" "Comprehensive Final Report Generation"; then
        success=false
    fi

    if [[ "$success" == "true" ]]; then
        log_success "✅ User Story 5: Final Report Generation completed successfully"
    else
        log_error "❌ User Story 5: Final Report Generation completed with errors"
    fi

    generate_progress_report "User Story 5 - Final Report Generation"
    return $([ "$success" == "true" ] && echo 0 || echo 1)
}

###############################################################################
# Main Execution Flow
###############################################################################

main() {
    print_banner

    log_info "Starting $SCRIPT_NAME v$SCRIPT_VERSION"
    log_info "Execution started: $EXECUTION_DATE"
    log_info "Main log file: $MAIN_LOG"
    echo ""

    # Track overall success
    local overall_success=true
    local completed_user_stories=0
    local total_user_stories=5

    # Phase 1: Prerequisites and setup
    log_step "🔧 Phase 1: Prerequisites and Setup"
    check_prerequisites
    test_database_connectivity
    echo ""

    # Phase 2: Execute user stories in priority order
    log_step "🚀 Phase 2: Migration Execution"

    # User Story 2: Personnel Tables (P1)
    if execute_user_story_2; then
        ((completed_user_stories++))
    else
        overall_success=false
    fi
    echo ""

    # User Story 1: Message Attachments (P1)
    if execute_user_story_1; then
        ((completed_user_stories++))
    else
        overall_success=false
    fi
    echo ""

    # User Story 3: Template Management (P2)
    if execute_user_story_3; then
        ((completed_user_stories++))
    else
        overall_success=false
    fi
    echo ""

    # User Story 4: Operational Data (P2)
    if execute_user_story_4; then
        ((completed_user_stories++))
    else
        overall_success=false
    fi
    echo ""

    # User Story 5: Final Report (P1)
    if execute_user_story_5; then
        ((completed_user_stories++))
    else
        overall_success=false
    fi
    echo ""

    # Phase 3: Final summary and cleanup
    log_step "📊 Phase 3: Final Summary"

    local completion_rate=$((completed_user_stories * 100 / total_user_stories))

    echo -e "${CYAN}"
    echo "###############################################################################"
    echo "#                          MIGRATION EXECUTION SUMMARY                       #"
    echo "###############################################################################"
    echo -e "${NC}"

    log_info "Execution completed: $(date '+%Y-%m-%d %H:%M:%S')"
    log_info "User stories completed: $completed_user_stories/$total_user_stories ($completion_rate%)"

    if [[ "$overall_success" == "true" ]]; then
        log_success "🎉 Final migration phase completed successfully!"
        log_success "✅ System is ready for validation and potential production deployment"
        log_info "📋 Check COMPREHENSIVE_FINAL_MIGRATION_REPORT.md for detailed results"
    else
        log_warning "⚠️ Final migration phase completed with some issues"
        log_warning "🔧 Review individual migration logs and address any failures"
        log_info "📋 Check COMPREHENSIVE_FINAL_MIGRATION_REPORT.md for detailed analysis"
    fi

    # List generated reports
    echo ""
    log_info "📁 Generated Reports:"
    ls -la *.md 2>/dev/null | grep -E "(MIGRATION_REPORT|VALIDATION_REPORT)" | while read -r line; do
        log_info "   $(echo "$line" | awk '{print $9}')"
    done

    # List log files
    echo ""
    log_info "📁 Execution Logs:"
    ls -la "$LOG_DIR"/*.log 2>/dev/null | tail -5 | while read -r line; do
        log_info "   $(echo "$line" | awk '{print $9}')"
    done

    echo ""
    if [[ "$overall_success" == "true" ]]; then
        log_success "🏁 Migration execution completed successfully!"
        exit 0
    else
        log_error "🏁 Migration execution completed with errors!"
        exit 1
    fi
}

###############################################################################
# Script Entry Point
###############################################################################

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Final Database Migration Phase Execution Script"
        echo ""
        echo "OPTIONS:"
        echo "  --help, -h     Show this help message"
        echo "  --dry-run      Perform a dry run (validation only)"
        echo "  --version      Show version information"
        echo ""
        echo "This script executes the complete final migration phase including:"
        echo "  - User Story 2: Personnel Tables (technicians, technician_roles)"
        echo "  - User Story 1: Message Attachments"
        echo "  - User Story 3: Template Management (placeholder)"
        echo "  - User Story 4: Operational Data (placeholder)"
        echo "  - User Story 5: Final Report Generation"
        echo ""
        echo "Environment Variables Required:"
        echo "  - SOURCE_DB_* : Source database connection parameters"
        echo "  - TARGET_DB_* : Target database connection parameters"
        echo "  - BATCH_SIZE  : Migration batch size (optional, default: 500)"
        exit 0
        ;;
    --version)
        echo "$SCRIPT_NAME v$SCRIPT_VERSION"
        exit 0
        ;;
    --dry-run)
        log_info "🧪 DRY RUN MODE: Would execute migrations but no data will be modified"
        export TEST_MODE=true
        ;;
    "")
        # No arguments - proceed with normal execution
        ;;
    *)
        log_error "Unknown argument: $1"
        log_info "Use --help for usage information"
        exit 1
        ;;
esac

# Execute main function
main "$@"