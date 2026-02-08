/**
 * 🔍 TURSO DATA DIAGNOSIS
 * 
 * Zeigt eine detaillierte Übersicht über alle Daten in Turso.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`🔍 TURSO DATABASE DIAGNOSE`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    // 1. Gesamt-Statistik
    const profileStats = await db.execute(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN isBaselineComplete = 1 THEN 1 ELSE 0 END) as baselineComplete,
            SUM(CASE WHEN profilePicUrl IS NOT NULL AND profilePicUrl != '' THEN 1 ELSE 0 END) as withPic,
            SUM(CASE WHEN profilePicUrl LIKE '/profile-pics/%' THEN 1 ELSE 0 END) as localPic,
            SUM(CASE WHEN baselineCreatedAt IS NOT NULL THEN 1 ELSE 0 END) as withBaselineDate
        FROM MonitoredProfile
    `);

    const stats = profileStats.rows[0];
    console.log(`📊 MONITORED PROFILES:`);
    console.log(`   Total: ${stats.total}`);
    console.log(`   Baseline Complete: ${stats.baselineComplete} (${((stats.baselineComplete as number) / (stats.total as number) * 100).toFixed(1)}%)`);
    console.log(`   Mit Profilbild: ${stats.withPic}`);
    console.log(`   Davon lokal: ${stats.localPic}`);
    console.log(`   Mit Baseline-Datum: ${stats.withBaselineDate}`);

    // 2. Following Entries
    const followingStats = await db.execute(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT profileId) as profiles,
            SUM(CASE WHEN profilePicUrl IS NOT NULL AND profilePicUrl != '' THEN 1 ELSE 0 END) as withPic
        FROM FollowingEntry
    `);

    const fStats = followingStats.rows[0];
    console.log(`\n📋 FOLLOWING ENTRIES:`);
    console.log(`   Total: ${fStats.total}`);
    console.log(`   Profile mit Einträgen: ${fStats.profiles}`);
    console.log(`   Mit Profilbild: ${fStats.withPic}`);

    // 3. Profile ohne Baseline aber mit Daten
    const incompleteWithData = await db.execute(`
        SELECT 
            mp.username,
            mp.followingCount,
            mp.isBaselineComplete,
            COUNT(fe.id) as actualEntries,
            CASE WHEN mp.followingCount > 0 
                 THEN ROUND(COUNT(fe.id) * 100.0 / mp.followingCount, 1) 
                 ELSE 0 END as coverage
        FROM MonitoredProfile mp
        LEFT JOIN FollowingEntry fe ON mp.id = fe.profileId
        WHERE (mp.isBaselineComplete = 0 OR mp.isBaselineComplete IS NULL)
        GROUP BY mp.id
        HAVING actualEntries > 0
        ORDER BY coverage DESC
        LIMIT 20
    `);

    if (incompleteWithData.rows.length > 0) {
        console.log(`\n⚠️ PROFILE OHNE BASELINE ABER MIT DATEN (Top 20):`);
        console.log(`   Username              | Einträge | Soll  | Coverage`);
        console.log(`   ──────────────────────|──────────|───────|─────────`);
        for (const row of incompleteWithData.rows) {
            const username = (row.username as string).padEnd(20);
            const entries = String(row.actualEntries).padStart(8);
            const expected = String(row.followingCount).padStart(5);
            const cov = String(row.coverage).padStart(6) + '%';
            console.log(`   ${username} | ${entries} | ${expected} | ${cov}`);
        }
    }

    // 4. Profile ohne Daten
    const noData = await db.execute(`
        SELECT 
            mp.username,
            mp.followingCount
        FROM MonitoredProfile mp
        LEFT JOIN FollowingEntry fe ON mp.id = fe.profileId
        GROUP BY mp.id
        HAVING COUNT(fe.id) = 0
        ORDER BY mp.username
        LIMIT 20
    `);

    if (noData.rows.length > 0) {
        console.log(`\n❌ PROFILE OHNE FOLLOWING-DATEN (Top 20):`);
        for (const row of noData.rows) {
            console.log(`   @${row.username} (${row.followingCount} Following)`);
        }
    }

    // 5. Change Events
    const changeStats = await db.execute(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type = 'FOLLOW' THEN 1 ELSE 0 END) as follows,
            SUM(CASE WHEN type = 'UNFOLLOW' THEN 1 ELSE 0 END) as unfollows
        FROM ChangeEvent
    `);

    const cStats = changeStats.rows[0];
    console.log(`\n📈 CHANGE EVENTS:`);
    console.log(`   Total: ${cStats.total}`);
    console.log(`   Follows: ${cStats.follows}`);
    console.log(`   Unfollows: ${cStats.unfollows}`);

    // 6. Monitoring Logs
    const logStats = await db.execute(`
        SELECT 
            status,
            COUNT(*) as count
        FROM MonitoringLog
        GROUP BY status
        ORDER BY count DESC
    `);

    console.log(`\n📊 MONITORING LOGS:`);
    for (const row of logStats.rows) {
        console.log(`   ${row.status}: ${row.count}`);
    }

    // 7. Abgelaufene Profilbilder erkennen
    const expiredPics = await db.execute(`
        SELECT COUNT(*) as count
        FROM MonitoredProfile
        WHERE profilePicUrl IS NOT NULL 
          AND profilePicUrl != ''
          AND profilePicUrl NOT LIKE '/profile-pics/%'
          AND profilePicUrl LIKE 'https://instagram%'
    `);

    console.log(`\n⚠️ ABGELAUFENE INSTAGRAM-URLs:`);
    console.log(`   Monitored Profiles: ${expiredPics.rows[0].count}`);

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`💡 EMPFOHLENE AKTIONEN:`);

    if ((stats.baselineComplete as number) < (stats.total as number)) {
        console.log(`   1. npx tsx scripts/utils/fix-baseline-flags.ts`);
    }
    if ((expiredPics.rows[0].count as number) > 0) {
        console.log(`   2. npx tsx scripts/utils/clear-profile-pics.ts`);
        console.log(`   3. npx tsx scripts/utils/fetch-profile-pics.ts "Bundesliga 300K+" --force`);
    }
    if (noData.rows.length > 0) {
        console.log(`   4. Cron-Job laufen lassen um Baselines zu erstellen`);
    }

    console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch(console.error);
