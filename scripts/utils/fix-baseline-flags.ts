/**
 * 🔧 FIX BASELINE FLAGS
 * 
 * Setzt isBaselineComplete = 1 für Profile die bereits Following-Einträge haben.
 * Behebt das Problem, dass alte Profile keinen Baseline-Status haben.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`🔧 BASELINE FLAGS REPARIEREN`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    // 1. Finde alle Profile ohne isBaselineComplete aber MIT Following-Einträgen
    const profilesWithData = await db.execute(`
        SELECT 
            mp.id,
            mp.username,
            mp.followingCount,
            mp.isBaselineComplete,
            COUNT(fe.id) as actualEntries
        FROM MonitoredProfile mp
        LEFT JOIN FollowingEntry fe ON mp.id = fe.profileId
        GROUP BY mp.id
        HAVING actualEntries > 0
    `);

    console.log(`📊 Profile mit Following-Einträgen: ${profilesWithData.rows.length}\n`);

    let fixed = 0;
    let alreadyComplete = 0;
    let needsWork = 0;

    for (const row of profilesWithData.rows) {
        const username = row.username as string;
        const followingCount = row.followingCount as number || 0;
        const actualEntries = row.actualEntries as number;
        const isComplete = row.isBaselineComplete as number;
        const coverage = followingCount > 0 ? (actualEntries / followingCount * 100) : 0;

        if (isComplete === 1) {
            alreadyComplete++;
            continue;
        }

        // Wenn Coverage >= 90%, markiere als complete
        if (coverage >= 90) {
            await db.execute({
                sql: `UPDATE MonitoredProfile SET 
                      isBaselineComplete = 1,
                      baselineCreatedAt = COALESCE(baselineCreatedAt, datetime('now')),
                      baselineFollowingCount = COALESCE(baselineFollowingCount, ?)
                      WHERE id = ?`,
                args: [actualEntries, row.id]
            });
            console.log(`✅ @${username}: ${actualEntries}/${followingCount} (${coverage.toFixed(1)}%) → Baseline gesetzt`);
            fixed++;
        } else {
            console.log(`⚠️ @${username}: ${actualEntries}/${followingCount} (${coverage.toFixed(1)}%) → Zu wenig Daten`);
            needsWork++;
        }
    }

    // 2. Zeige Statistik
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`📊 ERGEBNIS:`);
    console.log(`   ✅ Bereits komplett: ${alreadyComplete}`);
    console.log(`   🔧 Jetzt repariert: ${fixed}`);
    console.log(`   ⚠️ Braucht Scraping: ${needsWork}`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    // 3. Zeige Profile die noch Scraping brauchen
    if (needsWork > 0) {
        console.log(`\n📋 Profile die noch gescrapt werden müssen:`);
        const incomplete = await db.execute(`
            SELECT 
                mp.username,
                mp.followingCount,
                COUNT(fe.id) as actualEntries
            FROM MonitoredProfile mp
            LEFT JOIN FollowingEntry fe ON mp.id = fe.profileId
            WHERE mp.isBaselineComplete = 0 OR mp.isBaselineComplete IS NULL
            GROUP BY mp.id
            ORDER BY mp.username
            LIMIT 20
        `);

        for (const row of incomplete.rows) {
            const coverage = (row.followingCount as number) > 0
                ? ((row.actualEntries as number) / (row.followingCount as number) * 100).toFixed(1)
                : '0';
            console.log(`   @${row.username}: ${row.actualEntries}/${row.followingCount} (${coverage}%)`);
        }
    }
}

main().catch(console.error);
