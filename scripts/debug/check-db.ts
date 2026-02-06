/**
 * 🔍 DB DEBUG & BASELINE RESET
 * 
 * Zeigt den aktuellen Stand in der Datenbank und
 * ermöglicht das Zurücksetzen des Baselines.
 * 
 * Verwendung:
 *   npx tsx scripts/debug/check-db.ts                    # Status anzeigen
 *   npx tsx scripts/debug/check-db.ts reset morewatchez  # Baseline resetten
 *   npx tsx scripts/debug/check-db.ts set morewatchez 180 # Auf bestimmten Wert setzen
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

async function main() {
    const command = process.argv[2];
    const username = process.argv[3];
    const value = process.argv[4];

    console.log('═'.repeat(60));
    console.log('🔍 DATABASE DEBUG TOOL');
    console.log('═'.repeat(60));
    console.log('');

    if (!command || command === 'status') {
        // Status anzeigen
        console.log('📊 ALLE ÜBERWACHTEN PROFILE:\n');
        const result = await db.execute('SELECT * FROM MonitoredProfile ORDER BY username');

        if (result.rows.length === 0) {
            console.log('   Keine Profile gefunden.');
        } else {
            for (const row of result.rows) {
                console.log(`   @${row.username}`);
                console.log(`      ID: ${row.id}`);
                console.log(`      Following Count: ${row.followingCount}`);
                console.log(`      Baseline Complete: ${row.isBaselineComplete ? '✅' : '❌'}`);
                console.log(`      Last Checked: ${row.lastCheckedAt || 'Nie'}`);
                console.log(`      Screenshot: ${row.screenshotUrl || 'Keins'}`);
                console.log('');
            }
        }

        console.log('═'.repeat(60));
        console.log('BEFEHLE:');
        console.log('  npx tsx scripts/debug/check-db.ts reset <username>');
        console.log('      → Setzt followingCount auf 0 und Baseline auf false');
        console.log('');
        console.log('  npx tsx scripts/debug/check-db.ts set <username> <count>');
        console.log('      → Setzt followingCount auf bestimmten Wert');
        console.log('═'.repeat(60));

    } else if (command === 'reset' && username) {
        // Baseline resetten
        console.log(`🔄 RESET @${username}...`);

        const result = await db.execute({
            sql: `UPDATE MonitoredProfile SET 
                  followingCount = 0, 
                  isBaselineComplete = 0,
                  lastCheckedAt = NULL 
                  WHERE username = ?`,
            args: [username]
        });

        if (result.rowsAffected > 0) {
            console.log('✅ Baseline zurückgesetzt!');
            console.log('');
            console.log('Beim nächsten Monitor-Lauf wird:');
            console.log('  1. Die aktuelle Following-Zahl erfasst');
            console.log('  2. Die Following-Liste gescrapt');
            console.log('  3. Der neue Baseline gesetzt');
        } else {
            console.log(`❌ @${username} nicht gefunden.`);
        }

    } else if (command === 'set' && username && value) {
        // Auf bestimmten Wert setzen
        const count = parseInt(value);
        console.log(`📝 SETZE @${username} auf ${count}...`);

        const result = await db.execute({
            sql: `UPDATE MonitoredProfile SET 
                  followingCount = ?, 
                  isBaselineComplete = 1 
                  WHERE username = ?`,
            args: [count, username]
        });

        if (result.rowsAffected > 0) {
            console.log('✅ Wert gesetzt!');
        } else {
            console.log(`❌ @${username} nicht gefunden.`);
        }

    } else {
        console.log('❌ Unbekannter Befehl.');
        console.log('');
        console.log('Verwendung:');
        console.log('  npx tsx scripts/debug/check-db.ts              # Status');
        console.log('  npx tsx scripts/debug/check-db.ts reset <user> # Reset');
        console.log('  npx tsx scripts/debug/check-db.ts set <user> <n> # Set');
    }
}

main().catch(console.error);
