'use server';

import { prisma } from './prisma';
import { getInstagramClient, humanDelay, getProfileCheckDelay, getMaxProfilesPerSession, safeApiCall } from './instagram-client';
import { IgApiClient } from 'instagram-private-api';

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

// Use centralized client from instagram-client.ts

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
            const page = await safeApiCall(() => followingFeed.items());
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

            // Longer delay between pagination pages (key anti-bot measure!)
            if (followingFeed.isMoreAvailable()) {
                await humanDelay(3000, 6000);
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
    const previousUsernames = new Set(profile.followingList.map((f: any) => f.username));
    const currentUsernames = new Set(currentFollowing.map((f: any) => f.username));

    // Find new follows (in current, not in previous)
    const newFollows = currentFollowing.filter((u: any) => !previousUsernames.has(u.username));

    // Find unfollows (in previous, not in current)
    const unfollows = profile.followingList.filter((u: any) => !currentUsernames.has(u.username));

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

    const allProfiles = activeSets.flatMap((set: any) => set.profiles);
    console.log(`[Monitoring] Starting batch check for ${allProfiles.length} profiles`);

    if (allProfiles.length === 0) {
        console.log('[Monitoring] No profiles to check');
        return result;
    }

    // Get safe rate limit settings
    const { min: delayMin, max: delayMax } = getProfileCheckDelay();
    const maxProfiles = getMaxProfilesPerSession();

    // Limit profiles to check
    const profilesToCheck = allProfiles.slice(0, maxProfiles);
    if (allProfiles.length > maxProfiles) {
        console.log(`[Monitoring] ⚠️ Limiting to ${maxProfiles} profiles (${allProfiles.length} total) for safety`);
    }

    // Create ONE shared Instagram session for the entire batch
    const sharedIgClient = await getInstagramClient();
    if (!sharedIgClient) {
        result.errors.push('Failed to create Instagram session');
        return result;
    }

    for (const profile of profilesToCheck) {
        try {
            // Ensure profile is initialized (using shared session)
            await initializeProfile(profile.id, sharedIgClient);

            // Check for changes (using shared session)
            const changes = await checkProfileForChanges(profile.id, sharedIgClient);
            result.changesDetected.push(...changes);
            result.profilesChecked++;

            // Wait before next profile (60-120 seconds for safety)
            if (profilesToCheck.indexOf(profile) < profilesToCheck.length - 1) {
                await humanDelay(delayMin, delayMax);
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

// Use centralized session clearing
export async function clearMonitorInstagramSession() {
    const { clearInstagramSession } = require('./instagram-client');
    clearInstagramSession();
}
