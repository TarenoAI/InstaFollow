
import { IgApiClient, IgCheckpointError } from 'instagram-private-api';
import * as fs from 'fs';

async function debugLogin() {
    const ig = new IgApiClient();

    // Read creds (hardcoded for this debug script based on config.json)
    const username = 'oneshoot2034';
    const password = 'Balikesir100#';

    console.log(`Debug: Attempting login for ${username}...`);
    ig.state.generateDevice(username);

    try {
        const auth = await ig.account.login(username, password);
        console.log('✅ Login SUCCESSFUL!');
        console.log('User PK:', auth.pk);

        // Export state
        const serialized = await ig.state.serialize();
        delete serialized.constants; // Remove static constants to save space
        console.log('\nCopy the following SESSION STRING for Vercel:');
        console.log('---------------------------------------------------');
        console.log(JSON.stringify(serialized));
        console.log('---------------------------------------------------');
    } catch (error: any) {
        console.error('❌ Login FAILED');

        if (error instanceof IgCheckpointError) {
            console.log('⚠️  Checkpoint detected!');
            console.log('URL:', error.url);
            console.log('Api Info:', error.response.body);
            // Usually requires calling ig.challenge.auto(true) or similar
        } else {
            console.log('Error type:', error.name);
            console.log('Message:', error.message);
            if (error.response) {
                console.log('Full Response Body:', JSON.stringify(error.response.body, null, 2));
            }
        }
    }
}

debugLogin();
