import 'dotenv/config';
import { createClient } from '@libsql/client';

async function addColumn() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    try {
        await db.execute('ALTER TABLE ChangeEvent ADD COLUMN screenshotUrl TEXT');
        console.log('✅ screenshotUrl Spalte zu ChangeEvent hinzugefügt');
    } catch (e: any) {
        if (e.message.includes('duplicate column')) {
            console.log('ℹ️ Spalte existiert bereits');
        } else {
            console.error('Fehler:', e.message);
        }
    }
}

addColumn();
