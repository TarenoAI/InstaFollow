/**
 * 🧹 CLEANUP INACTIVE EVENTS
 * 
 * Löscht alle ChangeEvents von Profilen, die nicht mehr in einem aktiven Set sind.
 * Das hält die Datenbank sauber und verhindert Retry-Versuche für alte Test-Daten.
 */

import { createClient } from '@libsql/client';
import 'dotenv/config';

async function cleanupInactiveEvents() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n🧹 CLEANUP: Lösche Events von inaktiven Profilen...\n');

    // 1. Zeige zuerst, welche Profile AKTIV sind (in einem aktiven Set)
    const activeProfiles = await db.execute(`
        SELECT DISTINCT mp.id, mp.username 
        FROM MonitoredProfile mp
        JOIN _MonitoredProfileToProfileSet pts ON mp.id = pts.A
        JOIN ProfileSet ps ON pts.B = ps.id
        WHERE ps.isActive = 1
    `);
    console.log(`📋 Aktive Profile (in aktiven Sets): ${activeProfiles.rows.length}`);
    activeProfiles.rows.forEach(p => console.log(`   ✅ @${p.username}`));

    // 2. Finde Events von INAKTIVEN Profilen
    const inactiveEvents = await db.execute(`
        SELECT ce.id, ce.type, ce.targetUsername, ce.detectedAt, mp.username as monitoredUsername
        FROM ChangeEvent ce
        JOIN MonitoredProfile mp ON ce.profileId = mp.id
        WHERE mp.id NOT IN (
            SELECT DISTINCT pts.A 
            FROM _MonitoredProfileToProfileSet pts
            JOIN ProfileSet ps ON pts.B = ps.id
            WHERE ps.isActive = 1
        )
    `);

    console.log(`\n🗑️ Events von inaktiven Profilen: ${inactiveEvents.rows.length}`);

    if (inactiveEvents.rows.length === 0) {
        console.log('✅ Keine Events zum Löschen gefunden.\n');
        return;
    }

    // Zeige Beispiele
    const examples = inactiveEvents.rows.slice(0, 5);
    examples.forEach(e => {
        console.log(`   ❌ @${e.monitoredUsername} -> ${e.type} @${e.targetUsername} (${e.detectedAt})`);
    });
    if (inactiveEvents.rows.length > 5) {
        console.log(`   ... und ${inactiveEvents.rows.length - 5} weitere`);
    }

    // 3. Lösche die Events
    console.log('\n🗑️ Lösche Events...');
    const deleteResult = await db.execute(`
        DELETE FROM ChangeEvent
        WHERE profileId NOT IN (
            SELECT DISTINCT pts.A 
            FROM _MonitoredProfileToProfileSet pts
            JOIN ProfileSet ps ON pts.B = ps.id
            WHERE ps.isActive = 1
        )
    `);

    console.log(`✅ ${deleteResult.rowsAffected} Events gelöscht.\n`);

    // 4. Zeige verbleibende unverarbeitete Events
    const remaining = await db.execute(`
        SELECT COUNT(*) as cnt FROM ChangeEvent WHERE processed = 0
    `);
    console.log(`📊 Verbleibende unverarbeitete Events: ${remaining.rows[0].cnt}\n`);
}

cleanupInactiveEvents().catch(console.error);
