
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

const trustedKey = (userId: number) => `trusted_${userId}`;
const savedCarsKey = (userId: number) => `saved_cars_${userId}`;
const MAX_SAVED_CARS = 15;

export interface SavedCar {
  carNumber: string;
  regCode: string;
}

async function upsertEdgeConfigItem(key: string, value: unknown): Promise<void> {
  const url = new URL(`https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`);
  if (TEAM_ID) url.searchParams.set('teamId', TEAM_ID);

  const body = { items: [{ operation: 'upsert', key, value }] };
  const resp = await axios.patch(url.toString(), body, {
    headers: {
      Authorization: `Bearer ${VERCEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000,
    validateStatus: () => true
  });
  if (resp.status < 200 || resp.status >= 300) {
    const detail = typeof resp.data === 'object' ? JSON.stringify(resp.data) : String(resp.data ?? '');
    throw new Error(`Edge Config write failed: HTTP ${resp.status} ${detail}`);
  }
}

export async function isTrusted(userId: number): Promise<boolean> {
  const value = await get<string | null>(trustedKey(userId));
  return value === '1';
}

export async function trust(userId: number): Promise<void> {
  await upsertEdgeConfigItem(trustedKey(userId), '1');
}

function isSavedCar(value: unknown): value is SavedCar {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as SavedCar).carNumber === 'string' &&
    /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}$/.test((value as SavedCar).carNumber) &&
    typeof (value as SavedCar).regCode === 'string' &&
    /^\d{2,3}$/.test((value as SavedCar).regCode)
  );
}

export async function getSavedCars(userId: number): Promise<SavedCar[]> {
  const value = await get<unknown>(savedCarsKey(userId));
  return Array.isArray(value) ? value.filter(isSavedCar).slice(0, MAX_SAVED_CARS) : [];
}

export async function saveCar(userId: number, car: SavedCar): Promise<'saved' | 'exists' | 'limit'> {
  const cars = await getSavedCars(userId);
  if (cars.some((item) => item.carNumber === car.carNumber && item.regCode === car.regCode)) return 'exists';
  if (cars.length >= MAX_SAVED_CARS) return 'limit';

  await upsertEdgeConfigItem(savedCarsKey(userId), [...cars, car]);
  return 'saved';
}
