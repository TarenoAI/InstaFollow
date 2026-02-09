
import { createClient } from '@libsql/client';
import 'dotenv/config';

async function migrateDb() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('🚀 Migriere Datenbank manuell...');

    try {
        console.log('   ➕ Füge lastLoginStatus hinzu...');
        await db.execute("ALTER TABLE TwitterAccount ADD COLUMN lastLoginStatus BOOLEAN;");
    } catch (e: any) {
        if (e.message.includes('duplicate column')) {
            console.log('   ✅ Spalte lastLoginStatus existiert bereits.');
        } else {
            console.error('   ❌ Fehler bei lastLoginStatus:', e.message);
        }
    }

    try {
        console.log('   ➕ Füge lastStatusCheckAt hinzu...');
        await db.execute("ALTER TABLE TwitterAccount ADD COLUMN lastStatusCheckAt DATETIME;");
    } catch (e: any) {
        if (e.message.includes('duplicate column')) {
            console.log('   ✅ Spalte lastStatusCheckAt existiert bereits.');
        } else {
            console.error('   ❌ Fehler bei lastStatusCheckAt:', e.message);
        }
    }

    console.log('✅ Migration abgeschlossen!');
}

migrateDb();
