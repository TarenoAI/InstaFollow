import { IgApiClient } from 'instagram-private-api';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const COOKIE_PATH = path.join(process.cwd(), 'instagram-session.json');

interface Credentials {
    username: string;
    password: string;
}

// ============ SAFE RATE LIMITING ============

// Minimum delay between API calls (ms)
const MIN_DELAY_MS = 2000;  // 2 seconds minimum
const MAX_DELAY_MS = 5000;  // 5 seconds maximum

// Delay between checking different profiles (ms)
const PROFILE_DELAY_MIN_MS = 60000;  // 1 minute
const PROFILE_DELAY_MAX_MS = 120000; // 2 minutes

// Maximum profiles to check per session
const MAX_PROFILES_PER_SESSION = 15;

// Track last API call time for rate limiting
let lastApiCallTime = 0;

/**
 * Human-like delay with randomization
 */
export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    console.log(`[Rate-Limit] Waiting ${Math.round(delay / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Ensure minimum time between API calls
 */
async function rateLimitedCall<T>(apiCall: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;

    if (timeSinceLastCall < MIN_DELAY_MS) {
        const waitTime = MIN_DELAY_MS - timeSinceLastCall + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastApiCallTime = Date.now();
    return apiCall();
}

/**
 * Get the delay to use between profile checks
 */
export function getProfileCheckDelay(): { min: number; max: number } {
    return { min: PROFILE_DELAY_MIN_MS, max: PROFILE_DELAY_MAX_MS };
}

/**
 * Get max profiles allowed per session
 */
export function getMaxProfilesPerSession(): number {
    return MAX_PROFILES_PER_SESSION;
}

// ============ CREDENTIALS LOADING ============

/**
 * Load Instagram credentials from environment or config file
 */
export async function loadInstagramCredentials(): Promise<Credentials | null> {
    // Priority 1: Environment Variables
    if (process.env.INSTAGRAM_USERNAME && process.env.INSTAGRAM_PASSWORD) {
        return {
            username: process.env.INSTAGRAM_USERNAME,
            password: process.env.INSTAGRAM_PASSWORD
        };
    }

    // Priority 2: Local config.json
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// ============ SESSION MANAGEMENT ============

/**
 * Check if we have valid session cookies
 */
async function hasValidSessionCookies(): Promise<boolean> {
    // Check environment variable first
    if (process.env.INSTAGRAM_SESSION_ID && process.env.INSTAGRAM_SESSION_ID !== 'undefined') {
        return true;
    }

    // Check for session file
    try {
        await fs.access(COOKIE_PATH);
        return true;
    } catch {
        return false;
    }
}

/**
 * Load session from cookies (environment or file)
 */
async function loadSessionFromCookies(ig: IgApiClient): Promise<boolean> {
    try {
        // Method 1: Individual cookie values from environment
        const sessionId = process.env.INSTAGRAM_SESSION_ID;
        const csrfToken = process.env.INSTAGRAM_CSRF_TOKEN;
        const dsUserId = process.env.INSTAGRAM_DS_USER_ID;

        if (sessionId && sessionId !== 'undefined') {
            console.log('[Session] Loading from environment cookies...');

            // Manually set the cookies in the state
            const cookieJar = ig.state.cookieJar;
            const setCookie = (name: string, value: string) => {
                cookieJar.setCookie(
                    `${name}=${value}; Domain=.instagram.com; Path=/; Secure; HttpOnly`,
                    'https://www.instagram.com'
                );
            };

            setCookie('sessionid', sessionId);
            if (csrfToken) setCookie('csrftoken', csrfToken);
            if (dsUserId) setCookie('ds_user_id', dsUserId);

            // Verify the session works
            try {
                await rateLimitedCall(() => ig.account.currentUser());
                console.log('[Session] ✅ Environment cookies valid!');
                return true;
            } catch (e) {
                console.log('[Session] ❌ Environment cookies invalid or expired');
                return false;
            }
        }

        // Method 2: Full serialized session from environment (INSTAGRAM_SESSION or INSTAGRAM_COOKIE)
        const sessionEnvVar = process.env.INSTAGRAM_SESSION || process.env.INSTAGRAM_COOKIE;
        if (sessionEnvVar) {
            console.log('[Session] Loading from serialized session...');
            try {
                await ig.state.deserialize(JSON.parse(sessionEnvVar));

                try {
                    await rateLimitedCall(() => ig.account.currentUser());
                    console.log('[Session] ✅ Session restored from environment!');
                    return true;
                } catch (e) {
                    console.log('[Session] ❌ Serialized session invalid or expired');
                }
            } catch (parseError) {
                console.log('[Session] ❌ Failed to parse session JSON');
            }
        }

        // Method 3: Session file
        try {
            const sessionData = await fs.readFile(COOKIE_PATH, 'utf-8');
            await ig.state.deserialize(JSON.parse(sessionData));

            try {
                await rateLimitedCall(() => ig.account.currentUser());
                console.log('[Session] ✅ Session restored from file!');
                return true;
            } catch (e) {
                console.log('[Session] ❌ Session file invalid or expired');
                return false;
            }
        } catch {
            // No session file
        }

        return false;
    } catch (error) {
        console.error('[Session] Error loading cookies:', error);
        return false;
    }
}

/**
 * Save the current session to file for reuse
 */
async function saveSession(ig: IgApiClient): Promise<void> {
    try {
        const session = await ig.state.serialize();
        await fs.writeFile(COOKIE_PATH, JSON.stringify(session), 'utf-8');
        console.log('[Session] 💾 Session saved to file');
    } catch (error) {
        console.error('[Session] Failed to save session:', error);
    }
}

// ============ INSTAGRAM CLIENT ============

// Cached client
let cachedIgClient: IgApiClient | null = null;
let clientLastUsed: number = 0;
const CLIENT_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Get an authenticated Instagram client
 * Priority: Session Cookies > Password Login
 */
export async function getInstagramClient(): Promise<IgApiClient | null> {
    const now = Date.now();

    // Reuse cached client if still fresh
    if (cachedIgClient && (now - clientLastUsed) < CLIENT_CACHE_DURATION) {
        console.log('[Instagram] Reusing cached session');
        clientLastUsed = now;
        return cachedIgClient;
    }

    const credentials = await loadInstagramCredentials();
    if (!credentials) {
        console.error('[Instagram] No credentials configured');
        return null;
    }

    const ig = new IgApiClient();
    ig.state.generateDevice(credentials.username);

    // Try to restore from cookies first (safest!)
    const cookieSuccess = await loadSessionFromCookies(ig);

    if (cookieSuccess) {
        cachedIgClient = ig;
        clientLastUsed = now;
        return ig;
    }

    // Fallback: Password login (less safe, may trigger checkpoint)
    console.log('[Instagram] ⚠️ No valid cookies, attempting password login...');
    console.log('[Instagram] ℹ️ Consider setting up INSTAGRAM_SESSION_ID for safer operation');

    try {
        await humanDelay(2000, 4000); // Extra delay before login
        await ig.account.login(credentials.username, credentials.password);
        console.log('[Instagram] ✅ Login successful');

        // Save session for future use
        await saveSession(ig);

        cachedIgClient = ig;
        clientLastUsed = now;
        return ig;
    } catch (error: any) {
        const errorMessage = error.message || String(error);

        if (errorMessage.includes('challenge_required')) {
            console.error('[Instagram] ❌ Challenge required! Please:');
            console.error('  1. Log in to Instagram in your browser');
            console.error('  2. Complete any verification');
            console.error('  3. Export your session cookies (see COOKIE_SETUP.md)');
            console.error('  4. Set INSTAGRAM_SESSION_ID environment variable');
        } else if (errorMessage.includes('bad_password')) {
            console.error('[Instagram] ❌ Wrong password');
        } else {
            console.error('[Instagram] ❌ Login failed:', errorMessage);
        }

        return null;
    }
}

/**
 * Clear the cached session
 */
export async function clearInstagramSession(): Promise<void> {
    cachedIgClient = null;
    clientLastUsed = 0;

    // Also delete the session file
    try {
        await fs.unlink(COOKIE_PATH);
        console.log('[Session] Cleared session cache and file');
    } catch {
        console.log('[Session] Cleared session cache');
    }
}

/**
 * Wrapper for safe API calls with rate limiting
 */
export async function safeApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
    return rateLimitedCall(apiCall);
}
