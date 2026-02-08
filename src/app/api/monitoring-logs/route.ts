import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

export async function GET(request: NextRequest) {
    const profileId = request.nextUrl.searchParams.get('profileId');
    const fromDate = request.nextUrl.searchParams.get('from');
    const toDate = request.nextUrl.searchParams.get('to');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');

    if (!profileId) {
        return NextResponse.json({ error: 'profileId parameter required' }, { status: 400 });
    }

    try {
        const db = createClient({
            url: process.env.TURSO_DATABASE_URL!,
            authToken: process.env.TURSO_AUTH_TOKEN!
        });

        let sql = `SELECT * FROM MonitoringLog WHERE profileId = ?`;
        const args: (string | number)[] = [profileId];

        if (fromDate) {
            sql += ` AND createdAt >= ?`;
            args.push(fromDate);
        }
        if (toDate) {
            sql += ` AND createdAt <= ?`;
            args.push(toDate + ' 23:59:59');
        }

        sql += ` ORDER BY createdAt DESC LIMIT ?`;
        args.push(limit);

        const result = await db.execute({ sql, args });

        const logs = result.rows.map(row => ({
            id: row.id,
            profileId: row.profileId,
            profileUsername: row.profileUsername,
            status: row.status,
            followingCountLive: row.followingCountLive,
            followingCountDb: row.followingCountDb,
            scrapedCount: row.scrapedCount,
            scrapeQuote: row.scrapeQuote,
            newFollowsCount: row.newFollowsCount,
            unfollowsCount: row.unfollowsCount,
            newFollows: row.newFollows ? JSON.parse(row.newFollows as string) : null,
            unfollows: row.unfollows ? JSON.parse(row.unfollows as string) : null,
            errorMessage: row.errorMessage,
            durationMs: row.durationMs,
            createdAt: row.createdAt ? (row.createdAt as string).replace(' ', 'T') + 'Z' : null
        }));

        return NextResponse.json({ success: true, logs });
    } catch (error) {
        console.error('Monitoring logs error:', error);
        return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }
}
