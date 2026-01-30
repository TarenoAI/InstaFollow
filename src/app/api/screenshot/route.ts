import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
        return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    // Security: Only allow files from the screenshots directory
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    const resolvedPath = path.resolve(filePath);

    // Also allow absolute paths that point to screenshots dir
    const isInScreenshotsDir = resolvedPath.startsWith(screenshotsDir);
    const isRelativeScreenshot = filePath.includes('screenshots/') || filePath.startsWith('screenshots');

    if (!isInScreenshotsDir && !isRelativeScreenshot) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Resolve relative paths
    const finalPath = isInScreenshotsDir ? resolvedPath : path.join(process.cwd(), filePath);

    try {
        const fileBuffer = await fs.readFile(finalPath);
        const ext = path.extname(finalPath).toLowerCase();

        let contentType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.gif') contentType = 'image/gif';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400', // Cache for 24h
            },
        });
    } catch (error) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
}
