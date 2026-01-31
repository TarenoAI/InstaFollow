import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

async function check() {
    const tables = await db.execute('SELECT name FROM sqlite_master WHERE type="table"');
    console.log('Tables in Turso:', tables.rows.map(r => r.name));
}

check().catch(console.error);
