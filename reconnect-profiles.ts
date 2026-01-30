/**
 * Reconnect profiles to their sets based on their names
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

async function reconnect() {
    console.log('🔄 Reconnecting profiles to sets...\n');

    // Get all sets
    const sets = await db.execute('SELECT id, name FROM ProfileSet');
    console.log(`Found ${sets.rows.length} sets`);

    // Get all profiles
    const profiles = await db.execute('SELECT id, username FROM MonitoredProfile');
    console.log(`Found ${profiles.rows.length} profiles\n`);

    // Get the "Bundesliga 10k+" set (most profiles belong there)
    const bundesligaSet = sets.rows.find(s => (s.name as string).includes('Bundesliga'));
    const testSet = sets.rows.find(s => (s.name as string).includes('Test'));

    if (!bundesligaSet) {
        console.log('❌ Bundesliga set not found');
        return;
    }

    // Connect all profiles to Bundesliga set
    for (const profile of profiles.rows) {
        await db.execute({
            sql: `INSERT OR IGNORE INTO "_MonitoredProfileToProfileSet" ("A", "B") VALUES (?, ?)`,
            args: [profile.id, bundesligaSet.id]
        });
        console.log(`✅ @${profile.username} -> ${bundesligaSet.name}`);
    }

    console.log('\n✅ Done! All profiles reconnected.');
}

reconnect().catch(console.error);
