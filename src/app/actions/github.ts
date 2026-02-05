'use server';

/**
 * Server action to fetch screenshot history from GitHub repository
 */

interface ScreenshotInfo {
    url: string;
    filename: string;
    timestamp: Date;
    displayDate: string;
}

export async function getProfileScreenshots(username: string): Promise<ScreenshotInfo[]> {
    try {
        // Fetch directory listing from GitHub API
        const response = await fetch(
            'https://api.github.com/repos/TarenoAI/InstaFollow/contents/public/screenshots',
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    // Add auth token if available for higher rate limits
                    ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
                },
                next: { revalidate: 60 } // Cache for 60 seconds
            }
        );

        if (!response.ok) {
            console.error('[GitHub] Failed to fetch screenshots:', response.status);
            return [];
        }

        const files: any[] = await response.json();

        // Filter files that match the username pattern: username-timestamp.png
        const usernamePattern = new RegExp(`^${username.toLowerCase()}-\\d+\\.png$`);

        const screenshots: ScreenshotInfo[] = files
            .filter(file => usernamePattern.test(file.name.toLowerCase()))
            .map(file => {
                // Extract timestamp from filename: username-1770312945610.png
                const match = file.name.match(/-(\d+)\.png$/);
                const timestamp = match ? new Date(parseInt(match[1])) : new Date();

                return {
                    url: `https://raw.githubusercontent.com/TarenoAI/InstaFollow/main/public/screenshots/${file.name}`,
                    filename: file.name,
                    timestamp,
                    displayDate: timestamp.toLocaleString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                };
            })
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Most recent first

        return screenshots;
    } catch (error) {
        console.error('[GitHub] Error fetching screenshots:', error);
        return [];
    }
}
