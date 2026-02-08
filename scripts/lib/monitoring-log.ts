/**
 * 📊 MONITORING LOG HELPER
 * 
 * Speichert Berichte für jeden Monitor-Durchlauf.
 * Ermöglicht Nachverfolgung von Scrape-Erfolgen und Fehlern.
 */

import { createClient } from '@libsql/client';

// Status-Typen
export type LogStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NO_CHANGE' | 'SKIPPED' | 'ERROR';

export interface MonitoringLogEntry {
    profileId: string;
    profileUsername: string;
    status: LogStatus;
    followingCountLive?: number;
    followingCountDb?: number;
    scrapedCount?: number;
    scrapeQuote?: number;
    newFollowsCount?: number;
    unfollowsCount?: number;
    newFollows?: string[];
    unfollows?: string[];
    errorMessage?: string;
    durationMs?: number;
}

/**
 * Speichert einen Monitoring-Log-Eintrag in Turso
 */
export async function saveMonitoringLog(
    db: ReturnType<typeof createClient>,
    entry: MonitoringLogEntry
): Promise<void> {
    const id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        await db.execute({
            sql: `INSERT INTO MonitoringLog (
                id, profileId, profileUsername, status,
                followingCountLive, followingCountDb, scrapedCount, scrapeQuote,
                newFollowsCount, unfollowsCount, newFollows, unfollows,
                errorMessage, durationMs, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            args: [
                id,
                entry.profileId,
                entry.profileUsername,
                entry.status,
                entry.followingCountLive ?? null,
                entry.followingCountDb ?? null,
                entry.scrapedCount ?? null,
                entry.scrapeQuote ?? null,
                entry.newFollowsCount ?? 0,
                entry.unfollowsCount ?? 0,
                entry.newFollows ? JSON.stringify(entry.newFollows) : null,
                entry.unfollows ? JSON.stringify(entry.unfollows) : null,
                entry.errorMessage ?? null,
                entry.durationMs ?? null
            ]
        });
    } catch (error) {
        console.error(`   ⚠️ Konnte Log nicht speichern:`, error);
    }
}

/**
 * Holt die letzten N Logs für ein Profil
 */
export async function getProfileLogs(
    db: ReturnType<typeof createClient>,
    profileId: string,
    limit: number = 50
): Promise<MonitoringLogEntry[]> {
    const result = await db.execute({
        sql: `SELECT * FROM MonitoringLog 
              WHERE profileId = ? 
              ORDER BY createdAt DESC 
              LIMIT ?`,
        args: [profileId, limit]
    });

    return result.rows.map(row => ({
        profileId: row.profileId as string,
        profileUsername: row.profileUsername as string,
        status: row.status as LogStatus,
        followingCountLive: row.followingCountLive as number | undefined,
        followingCountDb: row.followingCountDb as number | undefined,
        scrapedCount: row.scrapedCount as number | undefined,
        scrapeQuote: row.scrapeQuote as number | undefined,
        newFollowsCount: row.newFollowsCount as number | undefined,
        unfollowsCount: row.unfollowsCount as number | undefined,
        newFollows: row.newFollows ? JSON.parse(row.newFollows as string) : undefined,
        unfollows: row.unfollows ? JSON.parse(row.unfollows as string) : undefined,
        errorMessage: row.errorMessage as string | undefined,
        durationMs: row.durationMs as number | undefined
    }));
}

/**
 * Erstellt die MonitoringLog-Tabelle falls nicht vorhanden
 */
export async function ensureMonitoringLogTable(
    db: ReturnType<typeof createClient>
): Promise<void> {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS MonitoringLog (
            id TEXT PRIMARY KEY NOT NULL,
            profileId TEXT NOT NULL,
            profileUsername TEXT NOT NULL,
            status TEXT NOT NULL,
            followingCountLive INTEGER,
            followingCountDb INTEGER,
            scrapedCount INTEGER,
            scrapeQuote REAL,
            newFollowsCount INTEGER DEFAULT 0,
            unfollowsCount INTEGER DEFAULT 0,
            newFollows TEXT,
            unfollows TEXT,
            errorMessage TEXT,
            durationMs INTEGER,
            createdAt TEXT DEFAULT (datetime('now'))
        )
    `);

    // Erstelle Indizes (ignoriere Fehler wenn sie schon existieren)
    try {
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_monitoring_log_profile ON MonitoringLog(profileId)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_monitoring_log_date ON MonitoringLog(createdAt)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_monitoring_log_status ON MonitoringLog(status)`);
    } catch {
        // Indizes existieren bereits
    }
}
