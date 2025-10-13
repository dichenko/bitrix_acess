
import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { env } from '../lib/env.js';
import { parseMessage, formatVisitAt } from '../lib/common.js';
import { submitPass } from '../lib/bitrix.js';
import { isTrusted, trust } from '../lib/trust.js';

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET');
const BOT_PASSWORD = env('BOT_PASSWORD');

const tg = axios.create({
  baseURL: `https://api.telegram.org/bot${BOT_TOKEN}/`,
  timeout: 12000
});

async function sendMessage(chatId: number, text: string) {
  await tg.post('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    if (req.query.secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const update = req.body;
    if (!update || !update.message) {
      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    const chatId: number = msg.chat.id;
    const userId: number = msg.from.id;
    const text: string = (msg.text || '').trim();

    if (!text) {
      await sendMessage(chatId, "Пришли текст вида: <b>ауди 123</b> или <b>330 киа</b>.");
      return res.status(200).json({ ok: true });
    }

    const trusted = await isTrusted(userId);
    if (!trusted) {
      if (text === '/start') {
        await sendMessage(chatId, "Введи пароль для доступа.");
        return res.status(200).json({ ok: true });
      }
      if (text === BOT_PASSWORD) {
        await trust(userId);
        await sendMessage(chatId, "Готово ✅ Ты добавлен в доверенные. Пиши марку и три цифры (например, \"ауди 123\").");
        return res.status(200).json({ ok: true });
      } else {
        await sendMessage(chatId, "Неверно или отсутствует пароль. Отправь /start, затем пароль.");
        return res.status(200).json({ ok: true });
      }
    }

    try {
      const { carInfo, number3 } = parseMessage(text);
      const visit = formatVisitAt();
      const result = await submitPass({ carInfo, number3, visitAt: visit });

      if (result.ok) {
        await sendMessage(chatId,
          `Пропуск оформлен ✅
Марка: <b>${carInfo}</b>
Номер: <b>${number3}</b>
Время: <b>${visit}</b>`);
      } else {
        await sendMessage(chatId,
          `Ошибка при оформлении ❌ (HTTP ${result.status})
<pre>${result.snippet}</pre>`);
      }
    } catch (e: any) {
      await sendMessage(chatId, `Ошибка: <pre>${(e?.message || 'unknown').slice(0, 300)}</pre>`);
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(200).json({ ok: true });
  }
}
