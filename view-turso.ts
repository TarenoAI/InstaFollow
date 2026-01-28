/**
 * Quick View - Zeigt die Turso-Daten
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

async function main() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    console.log('\n═══ TURSO DATENBANK INHALT ═══\n');

    // Profile Sets
    const sets = await db.execute('SELECT * FROM ProfileSet');
    console.log('📁 ProfileSets:', sets.rows.length);
    for (const row of sets.rows) {
        console.log(`   • ${row.name} (aktiv: ${row.isActive})`);
    }

    // Monitored Profiles
    const profiles = await db.execute('SELECT * FROM MonitoredProfile');
    console.log('\n👥 MonitoredProfiles:', profiles.rows.length);
    for (const row of profiles.rows) {
        console.log(`   • @${row.username} - Following: ${row.followingCount || '?'}, Verifiziert: ${row.isVerified ? 'Ja' : 'Nein'}`);
    }

    // Following Entries per Profile
    console.log('\n📋 Following pro Profil:');
    for (const profile of profiles.rows) {
        const entries = await db.execute({
            sql: 'SELECT username FROM FollowingEntry WHERE profileId = ? ORDER BY position LIMIT 10',
            args: [profile.id]
        });
        const total = await db.execute({
            sql: 'SELECT COUNT(*) as count FROM FollowingEntry WHERE profileId = ?',
            args: [profile.id]
        });

        console.log(`\n   @${profile.username} (${total.rows[0].count} gesamt):`);
        for (const entry of entries.rows) {
            console.log(`     • @${entry.username}`);
        }
        if (Number(total.rows[0].count) > 10) {
            console.log(`     ... und ${Number(total.rows[0].count) - 10} weitere`);
        }
    }

    console.log('\n');
}

main();
