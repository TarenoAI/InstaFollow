/**
 * 🗑️ CLEAR PROFILE PICS
 * 
 * Löscht alle profilePicUrl Einträge um frische URLs zu holen.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
    console.log(`\n🗑️ Lösche alle Profilbild-URLs...`);

    const result = await db.execute('UPDATE MonitoredProfile SET profilePicUrl = NULL');
    console.log(`✅ ${result.rowsAffected} Profile aktualisiert`);

    // Optional: Auch Following-Einträge
    const result2 = await db.execute('UPDATE FollowingEntry SET profilePicUrl = NULL');
    console.log(`✅ ${result2.rowsAffected} Following-Einträge aktualisiert`);

    console.log(`\n📸 Jetzt neu holen mit:`);
    console.log(`   npx tsx scripts/utils/fetch-profile-pics.ts "Bundesliga 300K+"\n`);
}

main().catch(console.error);
