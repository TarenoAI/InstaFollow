import { NextResponse } from 'next/server';
import { getTwitterAccounts } from '@/app/actions/db';

export async function GET() {
    try {
        const accounts = await getTwitterAccounts();
        return NextResponse.json({
            success: true,
            count: accounts.length,
            accounts
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error?.message || 'Unknown error'
        }, { status: 500 });
    }
}
