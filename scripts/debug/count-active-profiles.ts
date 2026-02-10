
import { createClient } from '@libsql/client';
import 'dotenv/config';

async function countProfiles() {
    const db = createClient({
        url: process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    const res = await db.execute("SELECT COUNT(*) as cnt FROM MonitoredProfile mp JOIN _MonitoredProfileToProfileSet pts ON mp.id = pts.A JOIN ProfileSet ps ON pts.B = ps.id WHERE ps.isActive = 1");
    console.log(`\nAktive Profile in Sets: ${res.rows[0].cnt}`);
}

countProfiles().catch(console.error);
