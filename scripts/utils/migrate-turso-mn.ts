/**
 * Migrate Turso DB to M:N relationship
 * Creates the _MonitoredProfileToProfileSet join table
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

async function migrate() {
    console.log('🔄 Creating M:N join table in Turso...');

    try {
        // Create join table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS "_MonitoredProfileToProfileSet" (
                "A" TEXT NOT NULL,
                "B" TEXT NOT NULL,
                FOREIGN KEY ("A") REFERENCES "MonitoredProfile"("id") ON DELETE CASCADE,
                FOREIGN KEY ("B") REFERENCES "ProfileSet"("id") ON DELETE CASCADE
            )
        `);

        // Create unique index
        await db.execute(`
            CREATE UNIQUE INDEX IF NOT EXISTS "_MonitoredProfileToProfileSet_AB_unique" 
            ON "_MonitoredProfileToProfileSet"("A", "B")
        `);

        // Create index on B
        await db.execute(`
            CREATE INDEX IF NOT EXISTS "_MonitoredProfileToProfileSet_B_index" 
            ON "_MonitoredProfileToProfileSet"("B")
        `);

        // Make username unique
        console.log('🔄 Updating MonitoredProfile schema...');

        // Check if setId column exists and drop it (SQLite doesn't support DROP COLUMN easily, so we'll recreate)
        // Actually for M:N we just need to add data to the join table based on existing setId relationships

        // Migrate existing setId relationships to join table
        const profiles = await db.execute(`SELECT id, setId, username FROM MonitoredProfile WHERE setId IS NOT NULL`);

        for (const row of profiles.rows) {
            const profileId = row.id as string;
            const setId = row.setId as string;

            // Insert into join table
            await db.execute({
                sql: `INSERT OR IGNORE INTO "_MonitoredProfileToProfileSet" ("A", "B") VALUES (?, ?)`,
                args: [profileId, setId]
            });
            console.log(`   ✅ Migrated: Profile ${profileId} -> Set ${setId}`);
        }

        console.log('\n✅ Migration complete!');

    } catch (error) {
        console.error('❌ Migration error:', error);
    }
}

migrate();
