import 'dotenv/config';
import { createClient } from '@libsql/client';

async function check() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    const changes = await db.execute('SELECT * FROM ChangeEvent ORDER BY detectedAt DESC LIMIT 10');
    console.log('ChangeEvents:', changes.rows.length);

    if (changes.rows.length > 0) {
        for (const row of changes.rows) {
            console.log(`  - ${row.type}: ${row.targetUsername} (detected: ${row.detectedAt})`);
        }
    } else {
        console.log('  (keine ChangeEvents gefunden)');
    }
}

check();
