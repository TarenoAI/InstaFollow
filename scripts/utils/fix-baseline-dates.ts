/**
 * 🔧 FIX BASELINE DATES
 * 
 * Setzt baselineCreatedAt für Profile die isBaselineComplete=1 haben aber kein Datum.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`🔧 BASELINE DATES REPARIEREN`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    // 1. Zeige aktuelle Statistik
    const stats = await db.execute(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN isBaselineComplete = 1 THEN 1 ELSE 0 END) as complete,
            SUM(CASE WHEN isBaselineComplete = 1 AND baselineCreatedAt IS NOT NULL THEN 1 ELSE 0 END) as withDate,
            SUM(CASE WHEN isBaselineComplete = 1 AND baselineCreatedAt IS NULL THEN 1 ELSE 0 END) as withoutDate
        FROM MonitoredProfile
    `);

    const s = stats.rows[0];
    console.log(`📊 Aktuelle Situation:`);
    console.log(`   Total Profile: ${s.total}`);
    console.log(`   Baseline Complete: ${s.complete}`);
    console.log(`   Mit Datum: ${s.withDate}`);
    console.log(`   Ohne Datum: ${s.withoutDate}`);

    // 2. Finde Profile ohne Datum
    const missingDates = await db.execute(`
        SELECT id, username, followingCount, baselineFollowingCount
        FROM MonitoredProfile
        WHERE isBaselineComplete = 1 AND baselineCreatedAt IS NULL
    `);

    if (missingDates.rows.length === 0) {
        console.log(`\n✅ Alle Baselines haben bereits ein Datum!`);
        return;
    }

    console.log(`\n🔧 Repariere ${missingDates.rows.length} Profile ohne Datum...\n`);

    for (const row of missingDates.rows) {
        // Setze Datum auf jetzt und baselineFollowingCount auf followingCount falls NULL
        await db.execute({
            sql: `UPDATE MonitoredProfile SET 
                  baselineCreatedAt = datetime('now'),
                  baselineFollowingCount = COALESCE(baselineFollowingCount, followingCount)
                  WHERE id = ?`,
            args: [row.id]
        });
        console.log(`   ✅ @${row.username}: Datum gesetzt`);
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`✅ ${missingDates.rows.length} Profile repariert!`);
    console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch(console.error);
