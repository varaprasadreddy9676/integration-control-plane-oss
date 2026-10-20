# Getting Started (Quick Reference)

This quick guide covers the fastest way to run Integration Gateway with accurate current defaults.

---

## 1. Recommended: Docker

```bash
git clone https://github.com/varaprasadreddy9676/integration-control-plane-oss.git
cd integration-control-plane-oss
```

Generate `.env` with random secrets (required; compose refuses to start without them):

```bash
./scripts/init-env.sh
```

Start stack:

```bash
docker compose up -d --build
```

Verify:

```bash
docker compose ps
curl http://localhost:3545/
curl http://localhost:3545/health
```

Open:

- UI: `http://localhost/integration-gateway/` (root URL also works). Create the first account with the command under "Create first admin user" below, sign in, and create an organization under Org Directory.
- API base: `http://localhost:3545/api/v1` (also served by the UI at `/api/v1`)

Health semantics:

- `GET /` is liveness.
- `GET /health` reports dependency/system health and may return non-200 when degraded.

---

## 2. Local Development (Without Docker)

### Backend

```bash
cd backend
npm install
```

Configure either env vars or `config.json`:

```bash
export MONGODB_URI="mongodb://localhost:27017/integration_gateway"
export MONGODB_DATABASE="integration_gateway"
export API_KEY="change_me_dev_key"
export JWT_SECRET="change_me_dev_secret"
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend dev server default: `http://localhost:5174`

Ensure `frontend/.env` contains:

- `VITE_API_BASE_URL=http://localhost:3545/api/v1`

Do not set `VITE_API_KEY` for a deployed console: everything compiled into the frontend bundle is readable by anyone who loads the page.

---

## 3. Useful Commands

Docker logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb
```

Backend file logs (inside container):

```bash
docker compose exec backend sh -lc "ls -la /app/logs"
```

Create first admin user (Docker stack):

```bash
docker compose exec backend node scripts/create-user.js \
  --email admin@example.com \
  --password 'ChangeMe123!' \
  --role SUPER_ADMIN
```
