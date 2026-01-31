import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ error: 'Missing username parameter' }, { status: 400 });
    }

    const screenshotsDir = path.join(process.cwd(), 'screenshots');

    try {
        const files = await fs.readdir(screenshotsDir);

        // Find all screenshots for this username (format: username_timestamp.png)
        const userScreenshots = files
            .filter(f => f.startsWith(`${username}_`) && f.endsWith('.png'))
            .sort()
            .reverse(); // Newest first (higher timestamp = newer)

        if (userScreenshots.length === 0) {
            return NextResponse.json({ error: 'No screenshots found' }, { status: 404 });
        }

        const latestScreenshot = userScreenshots[0];
        const filePath = path.join(screenshotsDir, latestScreenshot);
        const fileBuffer = await fs.readFile(filePath);

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=300', // Cache for 5 mins
                'X-Screenshot-Name': latestScreenshot,
            },
        });
    } catch (error) {
        console.error('Error loading screenshot:', error);
        return NextResponse.json({ error: 'Error loading screenshot' }, { status: 500 });
    }
}
