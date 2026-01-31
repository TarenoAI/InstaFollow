import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
        return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    // Support both old and new screenshot directory structures
    const newScreenshotsDir = path.join(process.cwd(), 'artifacts/screenshots');
    const oldScreenshotsDir = path.join(process.cwd(), 'screenshots');

    // Extract just the filename from the path
    const filename = path.basename(filePath);

    // Try new location first, then old location
    const possiblePaths = [
        path.join(newScreenshotsDir, filename),
        path.join(oldScreenshotsDir, filename),
        path.resolve(filePath), // Absolute path as fallback
    ];

    let finalPath: string | null = null;
    for (const p of possiblePaths) {
        try {
            await fs.access(p);
            finalPath = p;
            break;
        } catch {
            continue;
        }
    }

    if (!finalPath) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

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
        return NextResponse.json({ error: 'Error reading file' }, { status: 500 });
    }
}
