#!/usr/bin/env npx tsx
/**
 * Reset Baseline für ein Profil
 * Setzt isBaselineComplete auf 0 und löscht alle FollowingEntries
 * 
 * Usage: npx tsx scripts/reset-baseline.ts <username>
 */

import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

async function main() {
    const username = process.argv[2];

    if (!username) {
        console.log('Usage: npx tsx scripts/reset-baseline.ts <username>');
        console.log('       npx tsx scripts/reset-baseline.ts --all');
        process.exit(1);
    }

    const db = createClient({
        url: TURSO_URL,
        authToken: TURSO_TOKEN
    });

    if (username === '--all') {
        console.log('🗑️ Resette ALLE Profile...');

        // Lösche alle FollowingEntries
        await db.execute('DELETE FROM FollowingEntry');
        console.log('   ✅ Alle FollowingEntry gelöscht');

        // Setze alle Baselines zurück
        await db.execute('UPDATE MonitoredProfile SET isBaselineComplete = 0, followingCount = 0');
        console.log('   ✅ Alle Profile auf isBaselineComplete = 0 gesetzt');

        console.log('\n✅ Fertig! Beim nächsten Monitoring-Lauf wird die Baseline neu erstellt.');
    } else {
        console.log(`🗑️ Resette Baseline für @${username}...`);

        // Finde Profil
        const profile = await db.execute({
            sql: 'SELECT id, followingCount, isBaselineComplete FROM MonitoredProfile WHERE username = ?',
            args: [username]
        });

        if (profile.rows.length === 0) {
            console.log(`❌ Profil @${username} nicht gefunden`);
            process.exit(1);
        }

        const profileId = profile.rows[0].id as string;
        const oldCount = profile.rows[0].followingCount;
        const wasComplete = profile.rows[0].isBaselineComplete;

        console.log(`   Profil: ${profileId}`);
        console.log(`   Alter Count: ${oldCount}`);
        console.log(`   War Baseline komplett: ${wasComplete}`);

        // Lösche FollowingEntries
        const deleted = await db.execute({
            sql: 'DELETE FROM FollowingEntry WHERE profileId = ?',
            args: [profileId]
        });
        console.log(`   ✅ ${deleted.rowsAffected} FollowingEntries gelöscht`);

        // Setze Baseline zurück
        await db.execute({
            sql: 'UPDATE MonitoredProfile SET isBaselineComplete = 0, followingCount = 0 WHERE id = ?',
            args: [profileId]
        });
        console.log('   ✅ isBaselineComplete = 0 gesetzt');

        console.log(`\n✅ Fertig! Beim nächsten Monitoring-Lauf wird die Baseline für @${username} neu erstellt.`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fehler:', err);
    process.exit(1);
});
