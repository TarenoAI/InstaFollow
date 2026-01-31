import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ error: 'Missing username parameter' }, { status: 400 });
    }

    // Search in both old and new screenshot directories
    const newDir = path.join(process.cwd(), 'artifacts/screenshots');
    const oldDir = path.join(process.cwd(), 'screenshots');

    let allScreenshots: { name: string; dir: string }[] = [];

    // Check new directory
    try {
        const newFiles = await fs.readdir(newDir);
        allScreenshots.push(...newFiles
            .filter(f => f.startsWith(`${username}_`) && (f.endsWith('.png') || f.endsWith('.webp')))
            .map(name => ({ name, dir: newDir }))
        );
    } catch { /* Directory may not exist */ }

    // Check old directory
    try {
        const oldFiles = await fs.readdir(oldDir);
        allScreenshots.push(...oldFiles
            .filter(f => f.startsWith(`${username}_`) && (f.endsWith('.png') || f.endsWith('.webp')))
            .map(name => ({ name, dir: oldDir }))
        );
    } catch { /* Directory may not exist */ }

    if (allScreenshots.length === 0) {
        return NextResponse.json({ error: 'No screenshots found for this user' }, { status: 404 });
    }

    // Sort by name (which includes timestamp) - newest first
    allScreenshots.sort((a, b) => b.name.localeCompare(a.name));

    const latest = allScreenshots[0];
    const filePath = path.join(latest.dir, latest.name);

    try {
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(latest.name).toLowerCase();
        const contentType = ext === '.webp' ? 'image/webp' : 'image/png';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=300', // Cache for 5 mins
                'X-Screenshot-Name': latest.name,
            },
        });
    } catch (error) {
        console.error('Error loading screenshot:', error);
        return NextResponse.json({ error: 'Error loading screenshot' }, { status: 500 });
    }
}
