import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log("Checking Julian Brandt and Joao Palhinha...");
    const result = await db.execute({
        sql: "SELECT id, username, fullName, followerCount, followingCount, profilePicUrl, isBaselineComplete, baselineFollowingCount, baselineCreatedAt FROM MonitoredProfile WHERE username IN ('julianbrandt', 'joaopalhinha6')",
        args: []
    });
    console.table(result.rows);
}

main().catch(console.error);
