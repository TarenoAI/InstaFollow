# InstaFollows - Instagram Monitoring

A Next.js application to track changes in Instagram "Following" lists (Follows/Unfollows). It features a local SQLite database (ready for Turso), a monitoring automation workflow, and integration with n8n via Webhooks.

![InstaFollows UI](./public/file.svg)

## Features

*   **Set Management**: Create sets of Instagram profiles to monitor together.
*   **Monitoring**: Automatically fetches the "Following" list of profiles and detects changes.
*   **Anti-Bot**: Intelligent delays and session management to prevent Instagram blocks.
*   **History**: View a complete history of Follow/Unfollow events per profile.
*   **Automation**: Sends detected changes to an n8n Webhook for further processing (e.g. notifications, AI analysis).
*   **Data Persistence**: Uses Prisma with SQLite (locally) or LibSQL (Turso) for robust data storage.

## Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Initialize Database**:
    ```bash
    npx prisma migrate dev
    ```

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

4.  **Configure**:
    *   Open `http://localhost:3000`.
    *   Go to **Einstellungen** (Settings).
    *   Enter your Instagram credentials (username/password) - stored locally in `config.json`.
    *   (Optional) Enter your n8n Webhook URL in the **Automation** tab.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on how to deploy to Vercel and Turso.

## Automation Setup

The monitoring runs via an API endpoint: `GET /api/cron/monitor`.
You can trigger this manually or set up a cron job (e.g. via cron-job.org) to run it periodically (recommendation: every 30-60 minutes).
