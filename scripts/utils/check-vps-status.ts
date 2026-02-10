import { createClient } from '@libsql/client';
import 'dotenv/config';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function checkStatus() {
    console.log('📊 Instagram Monitoring Status Report\n');

    // 1. Monitored Profile Stats
    const profiles = await db.execute(`
        SELECT 
            isBaselineComplete, 
            COUNT(*) as count
        FROM MonitoredProfile 
        GROUP BY isBaselineComplete
    `);
    console.log('Profiles Baseline Status:');
    profiles.rows.forEach(row => console.log(`  - Baseline Complete ${row.isBaselineComplete}: ${row.count} profiles`));

    // 2. Recent Monitoring Logs
    const recentLogs = await db.execute(`
        SELECT 
            profileUsername, 
            status, 
            scrapedCount, 
            followingCountLive, 
            scrapeQuote, 
            createdAt
        FROM MonitoringLog
        ORDER BY createdAt DESC
        LIMIT 10
    `);
    console.log('\nRecent Monitoring Logs (Last 10):');
    recentLogs.rows.forEach(row => {
        console.log(`  [${row.createdAt}] @${row.profileUsername}: ${row.status} (${row.scrapedCount}/${row.followingCountLive}, ${row.scrapeQuote}%)`);
    });

    // 3. Recent Change Events
    const recentEvents = await db.execute(`
        SELECT 
            type, 
            targetUsername, 
            detectedAt, 
            processed, 
            (SELECT username FROM MonitoredProfile WHERE id = profileId) as monitor
        FROM ChangeEvent
        ORDER BY detectedAt DESC
        LIMIT 10
    `);
    console.log('\nRecent Change Events (Last 10):');
    recentEvents.rows.forEach(row => {
        console.log(`  [${row.detectedAt}] @${row.monitor} -> ${row.type} @${row.targetUsername} (Processed: ${row.processed})`);
    });

    // 4. ProfileSet Status
    const sets = await db.execute(`SELECT id, name, isActive FROM ProfileSet`);
    console.log('\nProfileSets Status:');
    sets.rows.forEach(row => console.log(`  - Set "${row.name}" (ID: ${row.id}): ${row.isActive ? '✅ Active' : '❌ Inactive'}`));

    // 5. Active Profile Count
    const activeCount = await db.execute(`
        SELECT COUNT(DISTINCT mp.id) as count
        FROM MonitoredProfile mp
        JOIN _MonitoredProfileToProfileSet pts ON mp.id = pts.A
        JOIN ProfileSet ps ON pts.B = ps.id
        WHERE ps.isActive = 1
    `);
    console.log(`\nMonitor Scope: ${activeCount.rows[0].count} profiles are in active sets.`);

    // 6. Coverage of uncompleted profiles
    const coverage = await db.execute(`
        SELECT 
            mp.username, 
            mp.followingCount, 
            (SELECT COUNT(*) FROM FollowingEntry fe WHERE fe.profileId = mp.id) as dbCount
        FROM MonitoredProfile mp
        WHERE mp.isBaselineComplete = 0
        LIMIT 10
    `);
    console.log('\nBaseline Coverage (Uncompleted Profiles):');
    coverage.rows.forEach(row => {
        const pct = row.followingCount > 0 ? ((Number(row.dbCount) / Number(row.followingCount)) * 100).toFixed(1) : '0';
        console.log(`  @${row.username}: ${row.dbCount}/${row.followingCount} (${pct}%)`);
    });
}

checkStatus().catch(console.error);
