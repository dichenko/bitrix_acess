import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { env } from '../lib/env.js';
import { parseMessage, formatVisitAt } from '../lib/common.js';
import { submitPass } from '../lib/bitrix.js';
import { isTrusted, trust } from '../lib/trust.js';

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET');
const BOT_PASSWORD = env('BOT_PASSWORD');

const log = (...args: unknown[]) => {
  console.log('[telegram]', ...args);
};

const tg = axios.create({
  baseURL: `https://api.telegram.org/bot${BOT_TOKEN}/`,
  timeout: 12000
});

async function sendMessage(chatId: number, text: string) {
  await tg.post('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    if (req.query.secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const update = req.body;
    if (!update || !update.message) {
      log('skip update without message');
      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    const chatId: number = msg.chat.id;
    const userId: number = msg.from.id;
    const text: string = (msg.text || '').trim();

    log('incoming message', {
      chatId,
      userId,
      textPreview: text.slice(0, 30),
      hasEntities: Array.isArray(msg.entities) && msg.entities.length > 0
    });

    if (!text) {
      await sendMessage(chatId, 'Отправьте текст в формате: <b>AK1234 330</b> или <b>330 дом</b>.');
      return res.status(200).json({ ok: true });
    }

    const trusted = await isTrusted(userId);
    if (!trusted) {
      log('user not trusted', { userId });
      if (text === '/start') {
        await sendMessage(chatId, 'Привет! Введите пароль для доступа.');
        return res.status(200).json({ ok: true });
      }
      if (text === BOT_PASSWORD) {
        await trust(userId);
        log('user trusted', { userId });
        await sendMessage(
          chatId,
          'Пароль принят. Можете отправить запрос в формате <b>Марка авто 123</b> или <b>330 дом</b>.'
        );
        return res.status(200).json({ ok: true });
      }

      await sendMessage(chatId, 'Пароль неверный. Наберите /start, чтобы попробовать снова.');
      return res.status(200).json({ ok: true });
    }

    try {
      const { carInfo, number3 } = parseMessage(text);
      const visit = formatVisitAt();
      log('parsed request', { userId, carInfo, number3, visit });

      const result = await submitPass({ carInfo, number3, visitAt: visit });

      if (result.ok) {
        await sendMessage(
          chatId,
          `Пропуск отправлен:
Авто: <b>${carInfo}</b>
Код: <b>${number3}</b>
Время визита: <b>${visit}</b>`
        );
        log('submission ok', { userId, status: result.status });
      } else {
        await sendMessage(
          chatId,
          `Не удалось отправить пропуск (HTTP ${result.status})
<pre>${result.snippet}</pre>`
        );
        log('submission failed', { userId, status: result.status });
      }
    } catch (e: any) {
      const message = (e?.message || 'unknown').slice(0, 300);
      log('handler error', { userId, error: message });
      await sendMessage(chatId, `Ошибка: <pre>${message}</pre>`);
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    log('unexpected error', { error: err?.message });
    return res.status(200).json({ ok: true });
  }
}
