import axios from 'axios';
import { env } from './env.js';

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const ADMIN_TELEGRAM_ID = Number(env('ADMIN_TELEGRAM_ID', '19422781'));

if (!Number.isFinite(ADMIN_TELEGRAM_ID) || ADMIN_TELEGRAM_ID <= 0) {
  throw new Error('ADMIN_TELEGRAM_ID must be a positive number');
}

const tg = axios.create({
  baseURL: `https://api.telegram.org/bot${BOT_TOKEN}/`,
  timeout: 30000
});

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRequester(user?: TelegramUser, source?: string): string {
  if (!user) return escapeHtml(source ?? 'REST API');

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || String(user.id);
  const username = user.username?.trim().replace(/^@+/, '');
  const usernameSuffix = username ? ` (@${username})` : '';
  const safeName = escapeHtml(`${name}${usernameSuffix}`);

  if (Number.isFinite(user.id) && user.id > 0) {
    return `<a href="tg://user?id=${user.id}">${safeName}</a>`;
  }

  if (username) {
    return `<a href="https://t.me/${username}">${safeName}</a>`;
  }

  return safeName;
}

export async function notifyAdminPassOrder(params: {
  user?: TelegramUser;
  source?: string;
  carInfo: string;
  number3: string;
  visit: string;
  ok: boolean;
  error?: string;
}): Promise<void> {
  const requester = formatRequester(params.user, params.source);
  const carNumber = escapeHtml(`${params.carInfo} ${params.number3}`.trim());
  const visit = escapeHtml(params.visit);
  const status = params.ok ? 'Успешно' : 'Ошибка';
  const errorText = params.error ? `\n<pre>${escapeHtml(params.error.slice(0, 300))}</pre>` : '';

  try {
    await tg.post('sendMessage', {
      chat_id: ADMIN_TELEGRAM_ID,
      text: `${status}: пользователь ${requester} заказал пропуск на <b>${carNumber}</b> <b>${visit}</b>${errorText}`,
      parse_mode: 'HTML'
    });
  } catch (err: any) {
    console.error('[admin-notification] failed', {
      status: err?.response?.status,
      data: err?.response?.data,
      error: err?.message ?? 'unknown'
    });
  }
}
