# Migration Coverage CLI

A command-line interface for the Migration Coverage API that provides easy access to migration status, validation, and reporting functionality.

## Installation

### Global Installation (Recommended)

```bash
npm install -g migration-coverage-cli
```

### Local Installation

```bash
npm install migration-coverage-cli
npx migration-coverage --help
```

### From Source

```bash
git clone <repository-url>
cd migration-coverage/cli
npm install
npm run build
npm link
```

## Configuration

Before using the CLI, configure the API connection:

```bash
migration-coverage config
```

This will prompt you to enter:
- **API Base URL**: The URL of your Migration Coverage API (default: http://localhost:3000)
- **API Key**: Optional API key for authentication

Configuration is saved to `.migration-coverage.json` in your current directory.

### Manual Configuration

You can also create the configuration file manually:

```json
{
  "apiUrl": "https://your-api-server.com",
  "apiKey": "your-optional-api-key"
}
```

## Commands

### Health Check

Check the health and status of the Migration Coverage API:

```bash
migration-coverage health
```

**Output:**
- System health status (healthy/degraded/unhealthy)
- Component status (database, services, etc.)
- System metrics (memory usage, uptime, etc.)
- Response times

### Coverage Summary

Get a high-level overview of migration coverage:

```bash
migration-coverage summary
# or
migration-coverage status
```

**Output:**
- Overall progress percentage
- Number of completed/total scripts
- Records migrated
- Success rates
- Domain-specific coverage
- Risk assessment
- Estimated completion time

### Scripts Status

List migration scripts with their current status:

```bash
migration-coverage scripts
```

**Options:**
- `-d, --domain <domain>` - Filter by domain (clinical, business, communications, technical)
- `-s, --status <status>` - Filter by status (pending, in_progress, completed, failed)
- `-c, --category <category>` - Filter by category
- `-p, --page <page>` - Page number for pagination (default: 1)
- `-l, --limit <limit>` - Items per page (default: 20, max: 200)

**Examples:**
```bash
# Show all clinical domain scripts
migration-coverage scripts --domain clinical

# Show only completed scripts
migration-coverage scripts --status completed

# Show scripts with pagination
migration-coverage scripts --page 2 --limit 10
```

### Validation

Run data validation and integrity checks:

#### Start Validation

```bash
migration-coverage validation run
```

**Options:**
- `-e, --entities <entities>` - Comma-separated list of entities to validate
- `--no-integrity` - Skip integrity checks
- `--no-cross-entity` - Skip cross-entity validation
- `-w, --wait` - Wait for validation to complete

**Examples:**
```bash
# Validate specific entities
migration-coverage validation run --entities "patients,orders"

# Run validation and wait for completion
migration-coverage validation run --wait

# Skip integrity checks
migration-coverage validation run --no-integrity
```

#### Check Validation Results

```bash
migration-coverage validation results <job-id>
```

**Example:**
```bash
migration-coverage validation results 123e4567-e89b-12d3-a456-426614174000
```

### Reports

Generate comprehensive migration reports:

```bash
migration-coverage report
```

**Options:**
- `-t, --type <type>` - Report type: comprehensive, coverage, executive, detailed (default: comprehensive)
- `-f, --format <format>` - Output format: json, html, markdown, csv (default: json)
- `-d, --details` - Include detailed information
- `-v, --validation` - Include validation results
- `-s, --save` - Save to file

**Examples:**
```bash
# Generate executive summary in HTML
migration-coverage report --type executive --format html --save

# Generate detailed report with validation
migration-coverage report --type detailed --validation --details

# Generate coverage report in markdown
migration-coverage report --type coverage --format markdown --save
```

## Usage Examples

### Daily Monitoring Workflow

```bash
# Check system health
migration-coverage health

# Get overall status
migration-coverage summary

# Check for any failed scripts
migration-coverage scripts --status failed

# Run validation if needed
migration-coverage validation run --wait
```

### Weekly Reporting Workflow

```bash
# Generate comprehensive report
migration-coverage report --type comprehensive --details --validation --save

# Generate executive summary for stakeholders
migration-coverage report --type executive --format html --save

# Check domain-specific progress
migration-coverage scripts --domain clinical
migration-coverage scripts --domain business
```

### Troubleshooting Workflow

```bash
# Check system health
migration-coverage health

# Identify problematic scripts
migration-coverage scripts --status failed

# Run detailed validation
migration-coverage validation run --entities "patients,orders" --wait

# Generate detailed analysis report
migration-coverage report --type detailed --validation --details --save
```

## Output Formats

### Table Output

Most commands display data in formatted tables with color coding:
- 🟢 **Green**: Healthy/Completed/Good performance
- 🟡 **Yellow**: Warning/In Progress/Needs attention
- 🔴 **Red**: Error/Failed/Critical issues

### JSON Output

For programmatic usage, use the `report` command with JSON format:

```bash
migration-coverage report --format json > migration-status.json
```

### File Output

Reports can be saved to files automatically:

```bash
migration-coverage report --type coverage --format html --save
# Creates: migration-report-coverage-2024-01-15T10-30-00-000Z.html
```

## Error Handling

The CLI provides clear error messages and appropriate exit codes:

- **0**: Success
- **1**: General error (API error, network error, etc.)

Common error scenarios:
- **Network Error**: API server not reachable
- **Authentication Error**: Invalid API key
- **Validation Error**: Invalid parameters
- **Timeout Error**: Operation took too long

## Environment Variables

You can also configure the CLI using environment variables:

```bash
export MIGRATION_COVERAGE_API_URL="https://your-api-server.com"
export MIGRATION_COVERAGE_API_KEY="your-api-key"
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Migration Coverage Check
on: [push, pull_request]

jobs:
  coverage-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install CLI
        run: npm install -g migration-coverage-cli

      - name: Configure CLI
        run: |
          echo '{"apiUrl":"${{ secrets.MIGRATION_API_URL }}","apiKey":"${{ secrets.MIGRATION_API_KEY }}"}' > .migration-coverage.json

      - name: Check Migration Status
        run: |
          migration-coverage health
          migration-coverage summary

      - name: Validate Data
        run: migration-coverage validation run --wait

      - name: Generate Report
        run: migration-coverage report --type executive --format markdown --save
```

### Jenkins Pipeline Example

```groovy
pipeline {
    agent any

    stages {
        stage('Migration Coverage Check') {
            steps {
                sh 'npm install -g migration-coverage-cli'

                withCredentials([
                    string(credentialsId: 'migration-api-url', variable: 'API_URL'),
                    string(credentialsId: 'migration-api-key', variable: 'API_KEY')
                ]) {
                    sh '''
                        echo "{\\"apiUrl\\":\\"$API_URL\\",\\"apiKey\\":\\"$API_KEY\\"}" > .migration-coverage.json
                        migration-coverage health
                        migration-coverage summary
                        migration-coverage validation run --wait
                    '''
                }
            }
        }
    }
}
```

## Troubleshooting

### Common Issues

**Command not found**
```bash
# Make sure CLI is installed globally
npm install -g migration-coverage-cli

# Or use npx
npx migration-coverage-cli health
```

**Connection refused**
```bash
# Check if API server is running
curl http://localhost:3000/health

# Verify configuration
cat .migration-coverage.json
```

**Timeout errors**
```bash
# Increase timeout (not currently configurable)
# Check API server performance
migration-coverage health
```

**Permission errors**
```bash
# On Unix systems, you might need sudo for global install
sudo npm install -g migration-coverage-cli
```

### Debug Mode

For detailed debugging information, set the DEBUG environment variable:

```bash
DEBUG=migration-coverage:* migration-coverage health
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

### Development Setup

```bash
git clone <repository-url>
cd migration-coverage/cli
npm install
npm run dev -- health  # Run in development mode
```

### Testing

```bash
npm test                # Run tests
npm run lint           # Run linter
npm run format         # Format code
```

## License

MIT License - see LICENSE file for details.