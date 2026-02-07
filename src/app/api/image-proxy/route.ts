import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'URL parameter required' }, { status: 400 });
    }

    try {
        console.log(`🖼️ [ImageProxy] Request for: ${url?.substring(0, 50)}...`);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site',
            },
            next: { revalidate: 3600 } // Cache auf Vercel Ebene für 1 Std
        });

        if (!response.ok) {
            console.error(`❌ [ImageProxy] Failed: ${response.status} ${response.statusText}`);
            return NextResponse.json({ error: `Instagram returned ${response.status}` }, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const buffer = await response.arrayBuffer();

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable', // Aggressives Caching
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (error: any) {
        console.error('Image proxy error:', error);
        return NextResponse.json({ error: error.message || 'Failed to proxy image' }, { status: 500 });
    }
}
