'use server';

import { prisma } from './prisma';
import { IgApiClient } from 'instagram-private-api';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

interface Credentials {
    username: string;
    password: string;
}

interface FollowingUser {
    pk: string;
    username: string;
    full_name: string;
    profile_pic_url: string;
    is_private: boolean;
    is_verified: boolean;
}

interface ChangeDetected {
    type: 'FOLLOW' | 'UNFOLLOW';
    sourceProfile: {
        username: string;
        fullName: string | null;
        profilePicUrl: string | null;
        followerCount: number | null;
        followingCount: number | null;
    };
    targetUser: {
        username: string;
        fullName: string | null;
        profilePicUrl: string | null;
    };
    detectedAt: Date;
}

// Cached Instagram client for batch operations
let cachedIgClient: IgApiClient | null = null;
let clientLastUsed: number = 0;
const CLIENT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Helper: Random delay to simulate human behavior
async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    console.log(`[Anti-Bot] Waiting ${Math.round(delay / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
}

// Load Instagram credentials
async function loadCredentials(): Promise<Credentials | null> {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// Create or reuse Instagram client (session caching)
async function getInstagramClient(): Promise<IgApiClient | null> {
    const now = Date.now();

    // Reuse cached client if still valid
    if (cachedIgClient && (now - clientLastUsed) < CLIENT_CACHE_DURATION) {
        console.log('[Anti-Bot] Reusing cached Instagram session');
        clientLastUsed = now;
        return cachedIgClient;
    }

    const credentials = await loadCredentials();
    if (!credentials) {
        console.error('[Monitoring] No Instagram credentials configured');
        return null;
    }

    try {
        console.log('[Anti-Bot] Creating new Instagram session...');
        const ig = new IgApiClient();

        // Generate consistent device ID based on username
        ig.state.generateDevice(credentials.username);

        // Small delay before login to seem more human
        await humanDelay(1000, 2000);

        await ig.account.login(credentials.username, credentials.password);

        // Cache the client
        cachedIgClient = ig;
        clientLastUsed = now;

        console.log('[Anti-Bot] Instagram session created and cached');
        return ig;
    } catch (error) {
        console.error('[Monitoring] Instagram login failed:', error);
        cachedIgClient = null;
        return null;
    }
}

// Fetch following list with anti-bot measures
async function fetchFollowingList(ig: IgApiClient, username: string): Promise<FollowingUser[] | null> {
    try {
        // Small delay before search
        await humanDelay(500, 1500);

        const searchResult = await ig.user.searchExact(username);
        const userId = searchResult.pk;

        // Small delay before fetching
        await humanDelay(1000, 2000);

        const followingFeed = ig.feed.accountFollowing(userId);
        const following: FollowingUser[] = [];
        let pageCount = 0;

        do {
            const page = await followingFeed.items();
            pageCount++;

            for (const user of page) {
                following.push({
                    pk: user.pk.toString(),
                    username: user.username,
                    full_name: user.full_name,
                    profile_pic_url: user.profile_pic_url,
                    is_private: user.is_private,
                    is_verified: user.is_verified || false,
                });
            }

            console.log(`[Monitoring] Fetched page ${pageCount}, total: ${following.length} following`);

            // Delay between pagination pages (key anti-bot measure!)
            if (followingFeed.isMoreAvailable()) {
                await humanDelay(2000, 4000);
            }

        } while (followingFeed.isMoreAvailable());

        console.log(`[Monitoring] Completed fetching ${following.length} following for @${username}`);
        return following;
    } catch (error) {
        console.error(`[Monitoring] Failed to fetch following for ${username}:`, error);
        return null;
    }
}

// Check a single profile for changes (uses shared session)
export async function checkProfileForChanges(profileId: string, sharedIgClient?: IgApiClient): Promise<ChangeDetected[]> {
    const changes: ChangeDetected[] = [];

    // Get profile from database
    const profile = await prisma.monitoredProfile.findUnique({
        where: { id: profileId },
        include: { followingList: true },
    });

    if (!profile) {
        console.error(`[Monitoring] Profile ${profileId} not found`);
        return changes;
    }

    console.log(`[Monitoring] Checking profile: @${profile.username}`);

    // Use shared client or get a new one
    const ig = sharedIgClient || await getInstagramClient();
    if (!ig) return changes;

    // Fetch current following list
    const currentFollowing = await fetchFollowingList(ig, profile.username);
    if (!currentFollowing) return changes;

    // Build sets for comparison
    const previousUsernames = new Set(profile.followingList.map(f => f.username));
    const currentUsernames = new Set(currentFollowing.map(f => f.username));

    // Find new follows (in current, not in previous)
    const newFollows = currentFollowing.filter(u => !previousUsernames.has(u.username));

    // Find unfollows (in previous, not in current)
    const unfollows = profile.followingList.filter(u => !currentUsernames.has(u.username));

    console.log(`[Monitoring] @${profile.username}: ${newFollows.length} new follows, ${unfollows.length} unfollows`);

    // Record changes
    const now = new Date();

    for (const user of newFollows) {
        const change: ChangeDetected = {
            type: 'FOLLOW',
            sourceProfile: {
                username: profile.username,
                fullName: profile.fullName,
                profilePicUrl: profile.profilePicUrl,
                followerCount: profile.followerCount,
                followingCount: profile.followingCount,
            },
            targetUser: {
                username: user.username,
                fullName: user.full_name,
                profilePicUrl: user.profile_pic_url,
            },
            detectedAt: now,
        };
        changes.push(change);

        // Save to database
        await prisma.changeEvent.create({
            data: {
                type: 'FOLLOW',
                targetUsername: user.username,
                targetFullName: user.full_name,
                targetPicUrl: user.profile_pic_url,
                profileId: profile.id,
            },
        });

        // Add to following list
        await prisma.followingEntry.create({
            data: {
                username: user.username,
                fullName: user.full_name,
                profilePicUrl: user.profile_pic_url,
                isPrivate: user.is_private,
                isVerified: user.is_verified,
                profileId: profile.id,
            },
        });
    }

    for (const user of unfollows) {
        const change: ChangeDetected = {
            type: 'UNFOLLOW',
            sourceProfile: {
                username: profile.username,
                fullName: profile.fullName,
                profilePicUrl: profile.profilePicUrl,
                followerCount: profile.followerCount,
                followingCount: profile.followingCount,
            },
            targetUser: {
                username: user.username,
                fullName: user.fullName,
                profilePicUrl: user.profilePicUrl,
            },
            detectedAt: now,
        };
        changes.push(change);

        // Save to database
        await prisma.changeEvent.create({
            data: {
                type: 'UNFOLLOW',
                targetUsername: user.username,
                targetFullName: user.fullName,
                targetPicUrl: user.profilePicUrl,
                profileId: profile.id,
            },
        });

        // Remove from following list
        await prisma.followingEntry.delete({
            where: {
                profileId_username: {
                    profileId: profile.id,
                    username: user.username,
                },
            },
        });
    }

    // Update last checked timestamp
    await prisma.monitoredProfile.update({
        where: { id: profile.id },
        data: { lastCheckedAt: now },
    });

    return changes;
}

// Initialize a profile (first-time fetch of following list)
export async function initializeProfile(profileId: string, sharedIgClient?: IgApiClient): Promise<boolean> {
    const profile = await prisma.monitoredProfile.findUnique({
        where: { id: profileId },
        include: { followingList: true },
    });

    if (!profile) {
        console.error(`[Monitoring] Profile ${profileId} not found`);
        return false;
    }

    // Skip if already initialized
    if (profile.followingList.length > 0) {
        console.log(`[Monitoring] Profile @${profile.username} already initialized with ${profile.followingList.length} entries`);
        return true;
    }

    console.log(`[Monitoring] Initializing profile: @${profile.username}`);

    const ig = sharedIgClient || await getInstagramClient();
    if (!ig) return false;

    const following = await fetchFollowingList(ig, profile.username);
    if (!following) return false;

    // Store initial following list
    for (const user of following) {
        await prisma.followingEntry.create({
            data: {
                username: user.username,
                fullName: user.full_name,
                profilePicUrl: user.profile_pic_url,
                isPrivate: user.is_private,
                isVerified: user.is_verified,
                profileId: profile.id,
            },
        });
    }

    await prisma.monitoredProfile.update({
        where: { id: profile.id },
        data: { lastCheckedAt: new Date() },
    });

    console.log(`[Monitoring] Initialized @${profile.username} with ${following.length} following entries`);
    return true;
}

// Run monitoring batch for all active profiles (with shared session)
export async function runMonitoringBatch(): Promise<{
    profilesChecked: number;
    changesDetected: ChangeDetected[];
    errors: string[];
}> {
    const result = {
        profilesChecked: 0,
        changesDetected: [] as ChangeDetected[],
        errors: [] as string[],
    };

    // Get all active sets with their profiles
    const activeSets = await prisma.profileSet.findMany({
        where: { isActive: true },
        include: { profiles: true },
    });

    const allProfiles = activeSets.flatMap(set => set.profiles);
    console.log(`[Monitoring] Starting batch check for ${allProfiles.length} profiles`);

    if (allProfiles.length === 0) {
        console.log('[Monitoring] No profiles to check');
        return result;
    }

    // Get delay setting
    const config = await prisma.appConfig.findUnique({ where: { id: 'app_config' } });
    const delayMs = config?.delayBetweenProfilesMs ?? 45000; // Default 45s

    // Create ONE shared Instagram session for the entire batch
    const sharedIgClient = await getInstagramClient();
    if (!sharedIgClient) {
        result.errors.push('Failed to create Instagram session');
        return result;
    }

    for (const profile of allProfiles) {
        try {
            // Ensure profile is initialized (using shared session)
            await initializeProfile(profile.id, sharedIgClient);

            // Check for changes (using shared session)
            const changes = await checkProfileForChanges(profile.id, sharedIgClient);
            result.changesDetected.push(...changes);
            result.profilesChecked++;

            // Wait before next profile to avoid rate limiting
            if (allProfiles.indexOf(profile) < allProfiles.length - 1) {
                // Random delay between 45s and 75s (more human-like)
                await humanDelay(delayMs, delayMs + 30000);
            }
        } catch (error) {
            const errorMsg = `Error checking @${profile.username}: ${error}`;
            console.error(`[Monitoring] ${errorMsg}`);
            result.errors.push(errorMsg);

            // Extra delay after an error
            await humanDelay(10000, 20000);
        }
    }

    console.log(`[Monitoring] Batch complete. Checked ${result.profilesChecked} profiles, found ${result.changesDetected.length} changes`);
    return result;
}

// Get unprocessed changes
export async function getUnprocessedChanges() {
    return prisma.changeEvent.findMany({
        where: { processed: false },
        include: {
            profile: true,
        },
        orderBy: { detectedAt: 'asc' },
    });
}

// Mark changes as processed
export async function markChangesAsProcessed(changeIds: string[]) {
    await prisma.changeEvent.updateMany({
        where: { id: { in: changeIds } },
        data: { processed: true, processedAt: new Date() },
    });
}

// Clear the cached session (useful for testing or manual reset)
export async function clearInstagramSession() {
    cachedIgClient = null;
    clientLastUsed = 0;
    console.log('[Anti-Bot] Instagram session cache cleared');
}
