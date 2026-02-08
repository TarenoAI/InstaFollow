import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log("🛠️ Syncing MonitoredProfile counts from MonitoringLog...");

    // Get latest log for each profile
    const latestLogs = await db.execute(`
        SELECT m1.profileId, m1.followingCountLive, mp.username, mp.fullName
        FROM MonitoringLog m1
        JOIN MonitoredProfile mp ON m1.profileId = mp.id
        WHERE m1.createdAt = (
            SELECT MAX(m2.createdAt)
            FROM MonitoringLog m2
            WHERE m2.profileId = m1.profileId
            AND m2.followingCountLive > 0
        )
        AND m1.followingCountLive > 0
    `);

    console.log(`📊 Found ${latestLogs.rows.length} profiles to sync.`);

    for (const row of latestLogs.rows) {
        const profileId = row.profileId as string;
        const count = row.followingCountLive as number;
        const username = row.username as string;
        let fullName = row.fullName as string;

        // Cleanup "Zurück" name if present
        if (fullName && fullName.includes('Zurück')) {
            fullName = fullName.replace('Zurück', '').trim();
            if (!fullName) fullName = username;
        }

        process.stdout.write(`   🔄 Updating @${username}: ${count} following... `);

        await db.execute({
            sql: `UPDATE MonitoredProfile SET 
                  followingCount = ?, 
                  fullName = ?
                  WHERE id = ?`,
            args: [count, fullName, profileId]
        });

        console.log("✅");
    }

    console.log("\n✨ Sync complete!");
}

main().catch(console.error);
