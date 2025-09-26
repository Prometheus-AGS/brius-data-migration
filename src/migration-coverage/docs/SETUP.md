# Migration Coverage API - Environment Setup Guide

This guide walks you through setting up the Migration Coverage API in various environments: development, staging, and production.

## Prerequisites

### System Requirements

- **Node.js**: 16.0.0 or higher (18.x recommended)
- **npm**: 8.0.0 or higher
- **PostgreSQL**: 12.0 or higher (15.x recommended)
- **Memory**: Minimum 2GB RAM (4GB+ recommended for production)
- **Storage**: Minimum 1GB free space (more for large databases and reports)

### Required Access

- **Source Database**: Read access to legacy PostgreSQL database
- **Target Database**: Full admin access to modern PostgreSQL database
- **Network**: Ability to connect to both databases
- **Ports**: 3000 (API), 5432 (PostgreSQL), 6379 (Redis - optional)

## Environment-Specific Setup

### Development Environment

#### 1. Clone and Install

```bash
git clone <repository-url>
cd migration-coverage
npm install
```

#### 2. Database Setup

**Option A: Use Docker (Recommended)**

```bash
# Start PostgreSQL container for target database
docker run -d \
  --name migration-target-db \
  -e POSTGRES_DB=migration_coverage_dev \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  postgres:15-alpine

# Wait for database to be ready
sleep 10

# Initialize database schema
docker exec -i migration-target-db psql -U postgres -d migration_coverage_dev < init-db/01-create-migration-tables.sql
```

**Option B: Local PostgreSQL**

```bash
# Create database
createdb migration_coverage_dev

# Initialize schema
psql -d migration_coverage_dev -f init-db/01-create-migration-tables.sql
```

#### 3. Configuration

```bash
cp .env.example .env
```

Edit `.env` with your database connections:

```bash
# Development environment
NODE_ENV=development
PORT=3000

# Source database (your existing legacy database)
SOURCE_DB_HOST=your-legacy-db-host
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=your_legacy_db
SOURCE_DB_USER=your_legacy_user
SOURCE_DB_PASSWORD=your_legacy_password
SOURCE_DB_SSL=true

# Target database (local development)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=5433
TARGET_DB_NAME=migration_coverage_dev
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=postgres
TARGET_DB_SSL=false

# Optional settings
LOG_LEVEL=debug
ENABLE_DEVELOPMENT_ENDPOINTS=true
```

#### 4. Start Development Server

```bash
# Build the application
npm run build

# Run tests
npm test

# Start development server
npm run dev
```

The API will be available at `http://localhost:3000`

#### 5. Verify Installation

```bash
# Check health
curl http://localhost:3000/health

# Get coverage summary
curl http://localhost:3000/coverage/summary

# Or use the CLI
npm install -g migration-coverage-cli
migration-coverage config
migration-coverage health
```

### Staging Environment

#### 1. Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL client
sudo apt-get install -y postgresql-client

# Install Docker and Docker Compose
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
```

#### 2. Application Deployment

```bash
# Clone application
git clone <repository-url>
cd migration-coverage

# Copy and configure environment
cp .env.docker .env
```

Edit `.env` for staging:

```bash
NODE_ENV=staging
PORT=3000

# Source database (production read replica recommended)
SOURCE_DB_HOST=legacy-db-replica.example.com
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=legacy_db
SOURCE_DB_USER=migration_readonly_user
SOURCE_DB_PASSWORD=secure_readonly_password
SOURCE_DB_SSL=true

# Target database (staging)
TARGET_DB_HOST=target-db
TARGET_DB_PORT=5432
TARGET_DB_NAME=migration_coverage_staging
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=secure_staging_password

# Security
API_KEY=staging_api_key_here

# CORS
CORS_ORIGINS=https://staging-dashboard.example.com
```

#### 3. Docker Deployment

```bash
# Build and start services
docker-compose up -d

# Verify deployment
docker-compose ps
docker-compose logs migration-coverage-api

# Check health
curl http://localhost:3000/health
```

#### 4. SSL Certificate (Production-like)

```bash
# Install certbot
sudo apt install certbot

# Generate certificate (for public staging)
sudo certbot certonly --standalone -d staging-api.example.com

# Copy certificates to nginx directory
sudo cp /etc/letsencrypt/live/staging-api.example.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/staging-api.example.com/privkey.pem nginx/ssl/key.pem
sudo chown $USER:$USER nginx/ssl/*

# Enable nginx proxy
docker-compose --profile production up -d nginx
```

### Production Environment

#### 1. Infrastructure Requirements

**Compute Resources:**
- **CPU**: 2-4 cores minimum
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 20GB minimum, SSD recommended
- **Network**: Reliable connection to both databases

**Database Requirements:**
- **Source Database**: Read-only replica recommended
- **Target Database**: Dedicated PostgreSQL instance
- **Backup Strategy**: Automated daily backups
- **Monitoring**: Database performance monitoring

#### 2. Security Hardening

```bash
# Create dedicated user
sudo adduser --system --group migration-api

# Set up firewall
sudo ufw enable
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS

# Install fail2ban
sudo apt install fail2ban

# Configure log rotation
sudo tee /etc/logrotate.d/migration-api << EOF
/opt/migration-coverage/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 migration-api migration-api
}
EOF
```

#### 3. Production Deployment

```bash
# Create application directory
sudo mkdir -p /opt/migration-coverage
sudo chown migration-api:migration-api /opt/migration-coverage

# Switch to application user
sudo -u migration-api -i

cd /opt/migration-coverage

# Clone and setup application
git clone <repository-url> .
npm ci --omit=dev

# Build application
npm run build
```

#### 4. Environment Configuration

Create `/opt/migration-coverage/.env`:

```bash
NODE_ENV=production
PORT=3000

# Source database (production read replica)
SOURCE_DB_HOST=legacy-db-replica.prod.example.com
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=legacy_production_db
SOURCE_DB_USER=migration_readonly_prod
SOURCE_DB_PASSWORD=ultra_secure_readonly_password
SOURCE_DB_SSL=true
SOURCE_DB_MAX_CONNECTIONS=5

# Target database (production)
TARGET_DB_HOST=migration-db.prod.example.com
TARGET_DB_PORT=5432
TARGET_DB_NAME=migration_coverage_prod
TARGET_DB_USER=migration_user
TARGET_DB_PASSWORD=ultra_secure_production_password
TARGET_DB_SSL=true
TARGET_DB_MAX_CONNECTIONS=10

# Security
API_KEY=production_api_key_generated_with_openssl_rand
CORS_ORIGINS=https://dashboard.example.com,https://admin.example.com

# Performance
RATE_LIMIT_MAX_REQUESTS=50
MAX_REQUEST_SIZE=5mb

# Monitoring
LOG_LEVEL=info
ENABLE_METRICS=true
```

#### 5. Systemd Service

Create `/etc/systemd/system/migration-coverage.service`:

```ini
[Unit]
Description=Migration Coverage API
After=network.target postgresql.service

[Service]
Type=simple
User=migration-api
Group=migration-api
WorkingDirectory=/opt/migration-coverage
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
ExecReload=/bin/kill -HUP $MAINPID
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=always
RestartSec=10

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/migration-coverage/logs /opt/migration-coverage/reports

# Resource limits
LimitNOFILE=65536
MemoryLimit=2G

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable migration-coverage
sudo systemctl start migration-coverage
sudo systemctl status migration-coverage
```

#### 6. Nginx Configuration

Install and configure Nginx:

```bash
sudo apt install nginx

# Copy nginx configuration
sudo cp nginx/nginx.conf /etc/nginx/sites-available/migration-coverage
sudo ln -s /etc/nginx/sites-available/migration-coverage /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Start nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

#### 7. SSL Certificate

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Generate certificate
sudo certbot --nginx -d api.migration-coverage.example.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

## Configuration Reference

### Environment Variables

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SOURCE_DB_HOST` | Legacy database hostname | `legacy-db.example.com` |
| `SOURCE_DB_NAME` | Legacy database name | `legacy_db` |
| `SOURCE_DB_USER` | Legacy database user | `readonly_user` |
| `SOURCE_DB_PASSWORD` | Legacy database password | `secure_password` |
| `TARGET_DB_HOST` | Modern database hostname | `localhost` |
| `TARGET_DB_NAME` | Modern database name | `migration_coverage` |
| `TARGET_DB_USER` | Modern database user | `postgres` |
| `TARGET_DB_PASSWORD` | Modern database password | `secure_password` |

#### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | Server port |
| `API_KEY` | _none_ | API authentication key |
| `LOG_LEVEL` | `info` | Logging level |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Rate limit per window |
| `SOURCE_DB_PORT` | `5432` | Source database port |
| `TARGET_DB_PORT` | `5432` | Target database port |
| `SOURCE_DB_SSL` | `false` | Enable SSL for source |
| `TARGET_DB_SSL` | `false` | Enable SSL for target |

### Database Schema Requirements

#### Source Database (Legacy)

The source database should contain tables with `dispatch_` prefix:
- `dispatch_office`
- `dispatch_patient`
- `dispatch_doctor`
- `dispatch_order`
- etc.

**Permissions required:**
- `SELECT` on all `dispatch_*` tables
- `CONNECT` to database
- Read access to `information_schema`

#### Target Database (Modern)

The target database will be automatically configured with:
- Migration tracking tables
- UUID-based entity tables
- Monitoring views
- Performance indexes

**Permissions required:**
- Full `CREATE`, `ALTER`, `DROP` permissions
- `INSERT`, `UPDATE`, `DELETE`, `SELECT` on all tables
- Function creation permissions

## Monitoring and Maintenance

### Health Monitoring

```bash
# API health check
curl http://localhost:3000/health

# Database connection check
curl http://localhost:3000/dev/database/status  # Development only

# System metrics
curl http://localhost:3000/health?includeDetails=true
```

### Log Monitoring

```bash
# Application logs
tail -f logs/application.log

# Nginx logs (if using)
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# System service logs
sudo journalctl -u migration-coverage -f
```

### Database Maintenance

```bash
# Connect to database
psql -h localhost -p 5432 -U postgres -d migration_coverage

# Check table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Clean old data (run monthly)
SELECT cleanup_old_migration_data(90); -- Keep 90 days
```

### Performance Monitoring

```bash
# API performance
curl http://localhost:3000/coverage/summary | jq '.responseTime'

# Database performance
curl http://localhost:3000/dev/database/status | jq '.statistics'  # Development

# Memory usage
curl http://localhost:3000/health | jq '.systemMetrics.memoryUsage'
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Symptoms:**
```
Database Error: Connection refused
```

**Solutions:**
```bash
# Check database is running
pg_isready -h $TARGET_DB_HOST -p $TARGET_DB_PORT

# Test connection manually
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME

# Check firewall/network
telnet $TARGET_DB_HOST $TARGET_DB_PORT

# Verify environment variables
echo $TARGET_DB_HOST $TARGET_DB_PORT $TARGET_DB_NAME
```

#### 2. Permission Errors

**Symptoms:**
```
Error: relation "migration_mappings" does not exist
```

**Solutions:**
```bash
# Run database initialization
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -f init-db/01-create-migration-tables.sql

# Check table permissions
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -c "\dp migration_mappings"

# Verify user permissions
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -c "SELECT current_user, session_user;"
```

#### 3. Memory Issues

**Symptoms:**
```
JavaScript heap out of memory
```

**Solutions:**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Or in systemd service
Environment=NODE_OPTIONS="--max-old-space-size=4096"

# Monitor memory usage
curl http://localhost:3000/health | jq '.systemMetrics.memoryUsage'
```

#### 4. Performance Issues

**Symptoms:**
- Slow API responses
- High CPU usage
- Database query timeouts

**Solutions:**
```bash
# Check database indexes
psql -d $TARGET_DB_NAME -c "
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;"

# Analyze slow queries
psql -d $TARGET_DB_NAME -c "
SELECT query, mean_time, calls
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;"

# Check connection pool usage
curl http://localhost:3000/dev/database/status | jq '.pools'
```

### Error Codes Reference

| HTTP Status | Meaning | Common Causes |
|-------------|---------|---------------|
| 400 | Bad Request | Invalid parameters, malformed JSON |
| 401 | Unauthorized | Missing or invalid API key |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Endpoint doesn't exist, resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Database error, application error |
| 503 | Service Unavailable | Database connection failed, system unhealthy |
| 504 | Gateway Timeout | Request timeout, slow database queries |

### Diagnostic Commands

```bash
# Full system diagnostic
migration-coverage health

# Database connectivity test
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -c "SELECT version(), current_database(), current_user, NOW();"

# API endpoint test
curl -w "@curl-format.txt" http://localhost:3000/coverage/summary

# Performance test
time curl http://localhost:3000/scripts/status?limit=100

# Memory usage check
curl http://localhost:3000/health | jq '.systemMetrics.memoryUsage'

# Log analysis
tail -f logs/application.log | grep -E "(ERROR|WARN)"
```

Create `curl-format.txt` for detailed timing:
```
time_namelookup:    %{time_namelookup}\n
time_connect:       %{time_connect}\n
time_appconnect:    %{time_appconnect}\n
time_pretransfer:   %{time_pretransfer}\n
time_redirect:      %{time_redirect}\n
time_starttransfer: %{time_starttransfer}\n
time_total:         %{time_total}\n
```

## Security Considerations

### Database Security

1. **Use read-only user for source database**
2. **Enable SSL/TLS for all database connections**
3. **Use connection pooling with appropriate limits**
4. **Regular security updates for PostgreSQL**
5. **Monitor for unusual query patterns**

### Application Security

1. **Generate strong API keys**: `openssl rand -base64 32`
2. **Use HTTPS in production**
3. **Implement proper CORS configuration**
4. **Regular security updates for Node.js and dependencies**
5. **Monitor for suspicious API usage patterns**

### Network Security

1. **Restrict database access to application servers only**
2. **Use VPN or private networks for database connections**
3. **Implement Web Application Firewall (WAF)**
4. **Regular security scanning**

## Backup and Recovery

### Database Backup

```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR="/opt/backups/migration-coverage"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

pg_dump -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  --no-password --format=custom --compress=9 \
  > $BACKUP_DIR/migration_coverage_$DATE.backup

# Keep only last 30 days
find $BACKUP_DIR -name "*.backup" -mtime +30 -delete
```

### Application Backup

```bash
# Backup application configuration and reports
tar -czf migration-coverage-config-$(date +%Y%m%d).tar.gz \
  .env nginx/ reports/ logs/
```

### Disaster Recovery

```bash
# Restore database
pg_restore -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME \
  --clean --if-exists migration_coverage_backup.backup

# Verify restoration
psql -h $TARGET_DB_HOST -p $TARGET_DB_PORT -U $TARGET_DB_USER -d $TARGET_DB_NAME -c "
SELECT COUNT(*) as mapping_count FROM migration_mappings;
SELECT COUNT(*) as control_count FROM migration_control;
"
```

## Scaling Considerations

### Horizontal Scaling

For high-availability deployments:

1. **Load Balancer**: Use AWS ALB, GCP Load Balancer, or HAProxy
2. **Multiple API Instances**: Deploy multiple containers/instances
3. **Database Read Replicas**: Use read replicas for query-heavy operations
4. **Caching Layer**: Redis for frequently accessed data
5. **CDN**: CloudFront/CloudFlare for static assets and API caching

### Vertical Scaling

Resource recommendations by deployment size:

| Deployment Size | CPU | RAM | Storage |
|-----------------|-----|-----|---------|
| Small (<100K records) | 2 cores | 4GB | 20GB |
| Medium (<1M records) | 4 cores | 8GB | 50GB |
| Large (<10M records) | 8 cores | 16GB | 100GB |
| Enterprise (>10M records) | 16+ cores | 32GB+ | 200GB+ |

## Support and Maintenance

### Regular Maintenance Tasks

**Daily:**
- Monitor health endpoint
- Check error logs
- Verify backup completion

**Weekly:**
- Review performance metrics
- Update security patches
- Clean old logs and reports

**Monthly:**
- Database maintenance (VACUUM, ANALYZE)
- Security audit
- Performance optimization review
- Disaster recovery test

### Getting Help

1. **Check logs**: Application and system logs
2. **Health endpoint**: `/health` with `?includeDetails=true`
3. **Documentation**: API documentation at `/docs`
4. **Issue tracker**: GitHub issues for bug reports
5. **Community**: Discussion forums or chat channels

### Emergency Contacts

- **Database Team**: db-team@example.com
- **DevOps Team**: devops@example.com
- **On-Call Engineer**: +1-555-0123 (production issues)
- **Escalation Manager**: manager@example.com

Remember to update these contacts with your actual team information.