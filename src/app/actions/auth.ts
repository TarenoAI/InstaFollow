'use server';

export async function checkAppPassword(password: string): Promise<{ success: boolean }> {
    const masterPassword = process.env.APP_PASSWORD;

    // If no password is set in environment, allow access (for safety, though user said they set it)
    if (!masterPassword) {
        return { success: true };
    }

    return { success: password === masterPassword };
}
