
import axios from 'axios';
import { get } from '@vercel/edge-config';
import { env } from './env.js';

/**
 * Reads: via Edge Config SDK (@vercel/edge-config) using EDGE_CONFIG conn string.
 * Writes: via Vercel REST API with Access Token.
 */
const EDGE_CONFIG_ID = env('EDGE_CONFIG_ID');
const VERCEL_ACCESS_TOKEN = env('VERCEL_ACCESS_TOKEN');
const TEAM_ID = process.env.APP_TEAM_ID ?? process.env.TEAM_ID;

export async function isTrusted(userId: number): Promise<boolean> {
  const key = `trusted:${userId}`;
  const value = await get<string | null>(key);
  return value === '1';
}

export async function trust(userId: number): Promise<void> {
  const key = `trusted:${userId}`;
  const url = new URL(`https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`);
  if (TEAM_ID) url.searchParams.set('teamId', TEAM_ID);

  const body = { items: [ { operation: 'upsert', key, value: '1' } ] };

  const resp = await axios.patch(url.toString(), body, {
    headers: {
      Authorization: `Bearer ${VERCEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 12000,
    validateStatus: () => true
  });
  if (resp.status < 200 || resp.status >= 300) {
    const detail = typeof resp.data === 'object' ? JSON.stringify(resp.data) : String(resp.data ?? '');
    throw new Error(`Edge Config write failed: HTTP ${resp.status} ${detail}`);
  }
}
