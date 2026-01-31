# InstaFollows Deployment Guide

This guide describes how to deploy the application for free/cheap using Vercel, Turso (Database), and Cron-job.org.

## 1. Database (Turso)
Since Vercel is serverless, we cannot use a local SQLite file (`dev.db`). We need a cloud database. Turso is a perfect fit as it is compatible with SQLite (LibSQL).

1.  **Create Turso Database**:
    *   Sign up at [turso.tech](https://turso.tech).
    *   Create a new database: `turso db create instafollows`
    *   Get the database URL: `turso db show instafollows --url` (starts with `libsql://`)
    *   Create an authentication token: `turso db tokens create instafollows`

2.  **Update Project**:
    *   Install LibSQL adapter: `npm install @libsql/client @prisma/adapter-libsql`
    *   Update `prisma/schema.prisma` (already compatible, just need to ensure `provider = "sqlite"`).
    *   Update `src/lib/prisma.ts` to use `PrismaLibSQL` adapter when `TURSO_DATABASE_URL` is present.

## 2. Vercel Deployment
1.  **Push to GitHub**: Push your code to a GitHub repository.
2.  **Import in Vercel**:
    *   Go to [vercel.com](https://vercel.com) -> Add New -> Project.
    *   Import your GitHub repo.
3.  **Environment Variables**:
    *   Add the following variables in Vercel settings:
        *   `TURSO_DATABASE_URL`: `libsql://name-org.turso.io`
        *   `TURSO_AUTH_TOKEN`: `eyJ...` (your token)
        *   `CRON_SECRET`: Optional, for securing the cron endpoint.

## 3. Automation (Cron Job)
To keep the monitoring running 24/7 without your laptop:

1.  **Sign up at cron-job.org** (Free).
2.  **Create Cron Job**:
    *   **URL**: `https://your-project.vercel.app/api/cron/monitor`
    *   **Schedule**: Every 30 minutes (or as desired).
    *   **Auth (Optional)**: If you set `CRON_SECRET`, add a header `Authorization: Bearer YOUR_SECRET`.

## 4. n8n Integration
*   Your n8n workflow URL is already saved in the database.
*   Make sure your n8n instance is publicly accessible so the Vercel app can reach it.

## 5. Deployment Checklist
- [ ] Database migrated (`npx prisma migrate deploy` or `prisma db push` locally against Turso URL)
- [ ] Environment variables set in Vercel
- [ ] Cron job configured
