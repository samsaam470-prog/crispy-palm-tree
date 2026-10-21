export default `# Interview Research Platform Backend

This repository contains the Cloudflare Workers + D1 backend for the Interview Research Platform. The goal is to support a protected admin workflow for creating and publishing interview versions while exposing a public questionnaire endpoint for participants.

## Architecture

- Cloudflare Worker entrypoint: \\`src/index.ts\\`
- Admin routes: \\`src/routes/auth.ts\\`, \\`src/routes/interviews.ts\\`, \\`src/routes/dashboard.ts\\`
- Public routes: \\`src/routes/public.ts\\`
- Shared configuration: \\`src/config/env.ts\\`
- Database migrations: \\`migrations/\\`

## Required environment

Set the following values in your Cloudflare Worker environment or local shell before running the app:

- \\`ADMIN_USER\\`
- \\`ADMIN_PASS\\`
- \\`JWT_KEY\\`
- \\`FRONTEND_ORIGIN\\`
- \\`NODE_ENV\\` (optional, defaults to development)

Do not commit production secrets. Use Wrangler secrets for \\`ADMIN_PASS\\` and \\`JWT_KEY\\`.

## Local development

1. Install dependencies:
   \\`npm install\\`
2. Create a local D1 database if needed:
   \\`npx wrangler d1 create interview-research-dev\\`
3. Update \\`wrangler.toml\\` with the generated database ID.
4. Start the worker:
   \\`npm run dev\\`

## Migration workflow

From the repo root:

- Apply migrations to a local database:
  \\`npx wrangler d1 execute interview-research-dev --file=./migrations/0001_initial_schema.sql\\`
  \\`npx wrangler d1 execute interview-research-dev --file=./migrations/0002_add_indexes.sql\\`

- The same files can be run against a Cloudflare D1 database once a binding is configured.

## Cloudflare configuration

Use Wrangler like this:

\\`toml
name = "crispy-palm-tree-backend"
main = "src/index.ts"
compatibility_date = "2024-10-22"

[vars]
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "interview-research-db"
database_id = "<insert-your-d1-id>"
migrations_dir = "migrations"
\\`

Then configure secrets:

\\`bash
wrangler secret put ADMIN_USER
wrangler secret put ADMIN_PASS
wrangler secret put JWT_KEY
\\`

And set a frontend origin variable:

\\`bash
wrangler kv:namespace create ...
# or use a variable in the Worker config
\\`

## Admin API

### Login

POST /api/auth/login

Request:

\\`json
{ "username": "admin", "password": "secret" }
\\`

Response:

\\`json
{ "success": true, "token": "<jwt>", "user": "admin" }
\\`

### Health

GET /api/health

Response:

\\`json
{ "ok": true, "status": "healthy", "timestamp": "2024-01-01T00:00:00.000Z" }
\\`

## Public API

GET /api/public/interviews/:publicId

Returns the published interview definition for a participant.

POST /api/public/interviews/:publicId/submissions

Request shape:

\\`json
{
  "participant_name": "Jane Doe",
  "participant_email": "jane@example.com",
  "answers": [
    { "question_id": "q_123", "selected_option_ids": ["opt_1"], "text_answer": null }
  ]
}
\\`

## Versioning & immutable published data

Published interview records remain tied to the version they were answered. Editing a published interview creates a new draft/version instead of mutating historical rows.

## CSV export

Protected admin endpoints can emit CSV exports using either mapping or readable full-answer output. The exports use neutral headers such as Q1, Q2, etc., and escape special characters to avoid formula injection.

## Tests

Run:

\\`bash
npm test
\\`

The repository includes a basic Vitest smoke suite for configuration and auth helpers. More comprehensive integration coverage should be added when a full D1 test harness is available.

## Deployment note

This repository prepares the Worker and D1 schema, but the actual Cloudflare database creation and deployment remain a manual step for the operator.
`;
