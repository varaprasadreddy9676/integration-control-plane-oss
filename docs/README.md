# Documentation Index

Use this index to find the right guide quickly.

## Architecture

- `docs/architecture/ARCHITECTURE.md` - System overview and component design
- `docs/architecture/SCHEDULED_JOBS.md` - Scheduled job architecture
- `docs/architecture/REPO_MAP.md` - Contributor-oriented repo map for inbound runtime, transformation, and lookups

## Setup and Operations

- `docs/guides/GETTING-STARTED.md` - Quick setup checklist
- `docs/guides/SETUP.md` - Detailed setup and deployment steps
- `docs/guides/DEPLOYMENT.md` - Production deployment guide
- `docs/DEPLOYMENT.md` - Deploying to the validation and production servers (`scripts/deploy.sh`, paths, troubleshooting)
- `docs/guides/APACHE-SPA-TROUBLESHOOTING.md` - Apache symlink and SPA refresh troubleshooting for frontend releases
- `docs/guides/DOCKER.md` - Docker build/deploy guide

## Security, RBAC, and Permissions

- `docs/guides/RBAC-GUIDE.md` - Roles and access model
- `docs/guides/FEATURE-PERMISSIONS-GUIDE.md` - Feature-level permissions
- `docs/guides/PERMISSIONS-SUMMARY.md` - Permission matrix
- `docs/guides/AUDIT-SEARCH-GUIDE.md` - Audit and search usage
- `docs/guides/WEBHOOK-SECURITY.md` - Outbound signing, inbound HMAC verification, request policy, SSRF protection
- `docs/guides/SECRETS-AND-RECOVERY.md` - Credential masking and encryption, the encryption key, and how to recover from key or server loss

## Features

- `docs/guides/ALERT-CENTER.md` - Alert categories, notification channels, failure reports, export
- `docs/guides/BULK-OPERATIONS.md` - Bulk create/update/delete, import/export (JSON + CSV), bulk DLQ retry
- `docs/guides/DLQ-GUIDE.md` - Dead Letter Queue lifecycle, auto-retry, manual operations
- `docs/guides/EVENT-SOURCES.md` - MySQL, Kafka, HTTP Push, and HL7 MLLP event source configuration
- `docs/guides/HL7-MLLP.md` - HL7 v2 over MLLP usage, JSON/HL7 transformations, ACK behavior, and Mirth migration notes
- `docs/guides/LOOKUP-TABLES.md` - Lookup table creation, XLSX import/export, script usage
- `docs/guides/OUTBOUND-LIFECYCLE.md` - Generic subject extraction, delayed lifecycle rules, and WAIT_FOR_CONDITION hold/release flows
- `docs/guides/VERSIONING.md` - Semantic versioning, diff view, rollback, templates
- `docs/guides/WEBHOOK-SECURITY.md` - Outbound HMAC signing, inbound HMAC auth, request policy, SSRF protection, auth types
- `docs/video-production/RECORDING-PLAN.md` - 10 product-demo recording plans with matching Remotion overlay scripts

## Planning and Roadmap

- `docs/ROADMAP.md` - Active roadmap and planned platform work
- `docs/plans/MCP-SERVER-FULL-PRODUCT-PLAN.md` - MCP-native operations and governance plan

## Backend Reference

- `backend/docs/DATA_SOURCE_EXECUTOR.md` - Data source executor behavior
- `backend/docs/COMMUNICATION_ADAPTERS.md` - Communication adapters (Email SMTP, WhatsApp Meta, Firebase FCM) and adapter registry pattern
