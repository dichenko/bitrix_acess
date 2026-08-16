import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { env } from '../lib/env.js';
import { parseMessage, formatVisitAt } from '../lib/common.js';
import { submitPass } from '../lib/bitrix.js';
import { getSavedCars, isTrusted, saveCar, trust } from '../lib/trust.js';
import { notifyAdminPassOrder, type TelegramUser } from '../lib/adminNotifications.js';

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET');
const BOT_PASSWORD = env('BOT_PASSWORD');
const YANDEX_STT_API_KEY = env('YANDEX_STT_API_KEY').trim();
const YANDEX_STT_FOLDER_ID = env('YANDEX_STT_FOLDER_ID').trim();
const YANDEX_STT_LANG = env('YANDEX_STT_LANG', 'ru-RU').trim();
const YANDEX_STT_TOPIC = env('YANDEX_STT_TOPIC', 'general').trim();

const VOICE_RECOGNITION_FAIL_MESSAGE = 'Бот не смог распознать полный номер автомобиля с регионом.';

const log = (...args: unknown[]) => {
  console.log('[telegram]', ...args);
};

const tg = axios.create({
  baseURL: `https://api.telegram.org/bot${BOT_TOKEN}/`,
  timeout: 30000
});

type ReplyMarkup = Record<string, unknown>;

async function sendMessage(chatId: number, text: string, replyMarkup?: ReplyMarkup) {
  await tg.post('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await tg.post('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

async function configureBotMenu() {
  await tg.post('setMyCommands', {
    commands: [{ command: 'saved', description: 'Сохраненные номера' }]
  });
}

const mainKeyboard: ReplyMarkup = {
  keyboard: [[{ text: 'Сохраненные' }]],
  resize_keyboard: true
};

function plateText(carNumber: string, regCode: string): string {
  return `${carNumber}${regCode}`;
}

function savedCarsKeyboard(cars: Array<{ carNumber: string; regCode: string }>): ReplyMarkup {
  return {
    inline_keyboard: cars.map((car) => [{
      text: plateText(car.carNumber, car.regCode),
      callback_data: `order:${plateText(car.carNumber, car.regCode)}`
    }])
  };
}

interface TelegramVoice {
  file_id: string;
  mime_type?: string;
  duration?: number;
}

interface TelegramFileResponse {
  ok: boolean;
  result?: {
    file_path?: string;
  };
  description?: string;
}

interface YandexSttResponse {
  result?: string;
  error_code?: number | string;
  error_message?: string;
}

function resolveYandexSttFormat(mime?: string): string | undefined {
  if (!mime) return undefined;
  const normalized = mime.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'audio/ogg':
    case 'audio/opus':
      return 'oggopus';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/flac':
      return 'flac';
    default:
      return undefined;
  }
}

async function recognizeVoiceMessage(voice: TelegramVoice): Promise<string> {
  log('voice recognition start', {
    fileId: voice.file_id,
    mimeType: voice.mime_type,
    duration: voice.duration
  });

  const { data: fileData } = await tg.post<TelegramFileResponse>('getFile', { file_id: voice.file_id });
  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(`telegram getFile failed: ${fileData.description ?? 'unknown error'}`);
  }

  log('voice file path resolved', {
    fileId: voice.file_id,
    filePath: fileData.result.file_path
  });

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
  const audioResp = await axios.get<ArrayBuffer>(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  });
  const audioBuffer = Buffer.from(audioResp.data);
  const audioFormat = resolveYandexSttFormat(voice.mime_type);

  log('voice file downloaded', {
    fileId: voice.file_id,
    byteLength: audioBuffer.byteLength,
    mimeType: voice.mime_type,
    format: audioFormat ?? 'auto'
  });

  const params = new URLSearchParams({
    lang: YANDEX_STT_LANG,
    topic: YANDEX_STT_TOPIC,
    folderId: YANDEX_STT_FOLDER_ID
  });
  if (audioFormat) params.set('format', audioFormat);

  log('voice stt request', {
    fileId: voice.file_id,
    lang: YANDEX_STT_LANG,
    topic: YANDEX_STT_TOPIC,
    hasFolderId: Boolean(YANDEX_STT_FOLDER_ID),
    format: audioFormat ?? null
  });

  const sttUrl = `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${params.toString()}`;
  let sttResp: AxiosResponse<YandexSttResponse | string>;
  try {
    sttResp = await axios.post<YandexSttResponse | string>(sttUrl, audioBuffer, {
      headers: {
        Authorization: `Api-Key ${YANDEX_STT_API_KEY}`,
        'Content-Type': voice.mime_type ?? 'application/octet-stream'
      },
      timeout: 30000,
      maxBodyLength: Infinity,
      validateStatus: () => true
    });
  } catch (rawErr: any) {
    log('voice stt request failed', {
      fileId: voice.file_id,
      error: rawErr?.message ?? 'unknown'
    });
    throw rawErr;
  }

  const sttStatus = sttResp.status;
  const responseData = sttResp.data;
  const sttSnippet =
    typeof responseData === 'string'
      ? responseData.slice(0, 200)
      : JSON.stringify(responseData).slice(0, 200);

  log('voice stt response raw', {
    fileId: voice.file_id,
    status: sttStatus,
    snippet: sttSnippet
  });

  if (sttStatus >= 400) {
    throw new Error(`Yandex STT HTTP ${sttStatus}: ${sttSnippet}`);
  }

  if (!responseData || typeof responseData !== 'object') {
    throw new Error('Yandex STT returned malformed response');
  }

  const sttData = responseData as YandexSttResponse;

  if (sttData.error_code) {
    throw new Error(`Yandex STT error ${sttData.error_code}: ${sttData.error_message ?? 'unknown'}`);
  }

  log('voice stt response', {
    fileId: voice.file_id,
    hasResult: Boolean(sttData.result),
    errorCode: sttData.error_code ?? null,
    resultPreview: sttData.result ? sttData.result.slice(0, 50) : ''
  });

  return (sttData.result ?? '').trim();
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
    const callback = update?.callback_query;
    if (!update || (!update.message && !callback?.message)) {
      log('skip update without message or callback');
      return res.status(200).json({ ok: true });
    }

    const msg = update.message ?? callback.message;
    const chatId: number = msg.chat.id;
    const user = (callback?.from ?? msg.from) as TelegramUser;
    const userId: number = user.id;
    const hasVoice = !callback && Boolean(msg.voice);
    let text = (callback?.data || msg.text || msg.caption || '').trim();
    let textFromVoice = false;

    if (hasVoice) {
      const voiceMeta = msg.voice as TelegramVoice;
      log('voice message metadata', {
        userId,
        fileId: voiceMeta.file_id,
        duration: voiceMeta.duration,
        mimeType: voiceMeta.mime_type,
        hasCaption: Boolean(msg.caption),
        initialTextLength: text.length
      });
    }

    log('incoming message', {
      chatId,
      userId,
      textPreview: text.slice(0, 30),
      hasEntities: Array.isArray(msg.entities) && msg.entities.length > 0,
      hasVoice
    });

    if (!text && hasVoice) {
      textFromVoice = true;
      try {
        log('voice transcription requested', {
          userId,
          fileId: (msg.voice as TelegramVoice).file_id
        });

        text = await recognizeVoiceMessage(msg.voice as TelegramVoice);
        if (text) {
          log('voice transcription', { userId, textPreview: text.slice(0, 50), length: text.length });
        }
      } catch (voiceErr: any) {
        const message = (voiceErr?.message || 'unknown').slice(0, 200);
        log('voice recognition failed', { userId, error: message });
        await sendMessage(chatId, VOICE_RECOGNITION_FAIL_MESSAGE);
        return res.status(200).json({ ok: true });
      }
    }

    if (!text) {
      await sendMessage(chatId, hasVoice ? VOICE_RECOGNITION_FAIL_MESSAGE : 'Отправьте полный номер с регионом, например: <b>А123АА77</b> или <b>а 123 аа 190</b>.');
      return res.status(200).json({ ok: true });
    }

    const trusted = await isTrusted(userId);
    if (trusted) {
      try {
        await configureBotMenu();
      } catch (menuErr: any) {
        log('bot menu setup failed', { error: menuErr?.message ?? 'unknown' });
      }
    }
    if (!trusted) {
      log('user not trusted', { userId });
      if (text === '/start') {
        await sendMessage(chatId, 'Введите номер квитанции для доступа.');
        return res.status(200).json({ ok: true });
      }
      if (text === BOT_PASSWORD) {
        try {
          await trust(userId);
          log('user trusted', { userId });
          await sendMessage(
            chatId,
            'Идентификация пройдена. Отправьте полный номер с регионом, например <b>А123АА77</b> или <b>а 123 аа 190</b>.',
            mainKeyboard
          );
        } catch (err: any) {
          const message = (err?.message || 'unknown').slice(0, 200);
          log('trust write failed', { userId, error: message });
          await sendMessage(
            chatId,
            'Пароль принят, но не удалось сохранить доступ. Попробуйте позже или свяжитесь с администратором.'
          );
        }
        return res.status(200).json({ ok: true });
      }

      await sendMessage(chatId, 'Пароль неверный. Наберите /start, чтобы попробовать снова.');
      return res.status(200).json({ ok: true });
    }

    if (text === '/saved' || text === 'Сохраненные') {
      const cars = await getSavedCars(userId);
      if (!cars.length) {
        await sendMessage(chatId, 'Сохраненных номеров пока нет. После заказа пропуска бот предложит сохранить номер.', mainKeyboard);
      } else {
        await sendMessage(chatId, 'Выберите номер для быстрого заказа пропуска:', savedCarsKeyboard(cars));
      }
      return res.status(200).json({ ok: true });
    }

    if (callback?.data === 'skip_save') {
      await answerCallbackQuery(callback.id, 'Номер не сохранен');
      return res.status(200).json({ ok: true });
    }

    if (callback?.data?.startsWith('save:')) {
      try {
        const car = parseMessage(callback.data.slice('save:'.length));
        const status = await saveCar(userId, car);
        const message = status === 'saved'
          ? 'Номер сохранен'
          : status === 'exists'
            ? 'Этот номер уже сохранен'
            : 'Можно сохранить не более 15 номеров';
        await answerCallbackQuery(callback.id, message);
      } catch (err: any) {
        log('save car failed', { userId, error: err?.message ?? 'unknown' });
        await answerCallbackQuery(callback.id, 'Не удалось сохранить номер');
      }
      return res.status(200).json({ ok: true });
    }

    if (callback?.data?.startsWith('order:')) {
      text = callback.data.slice('order:'.length);
      await answerCallbackQuery(callback.id);
    }

    let carNumber: string;
    let regCode: string;
    try {
      ({ carNumber, regCode } = parseMessage(text));
    } catch (parseErr: any) {
      const message = (parseErr?.message || 'unknown').slice(0, 300);
      log('parse error', { userId, error: message, fromVoice: textFromVoice });
      await sendMessage(chatId, textFromVoice ? VOICE_RECOGNITION_FAIL_MESSAGE : `Ошибка: <pre>${message}</pre>`);
      return res.status(200).json({ ok: true });
    }

    const visit = formatVisitAt();

    try {
      log('parsed request', { userId, carNumber, regCode, visit });

      const result = await submitPass({ carNumber, regCode, visitAt: visit });

      if (result.ok) {
        await notifyAdminPassOrder({ user, carNumber, regCode, visit, ok: true });
        await sendMessage(
          chatId,
          `Пропуск заказан:
Номер: <b>${carNumber}${regCode}</b>
Время визита: <b>${visit}</b>`
        );
        await sendMessage(
          chatId,
          `Сохранить номер <b>${plateText(carNumber, regCode)}</b> для быстрого заказа пропусков?`,
          {
            inline_keyboard: [[
              { text: 'Сохранить', callback_data: `save:${plateText(carNumber, regCode)}` },
              { text: 'Не сохранять', callback_data: 'skip_save' }
            ]]
          }
        );
        log('submission ok', { userId, status: result.status });
      } else {
        await notifyAdminPassOrder({ user, carNumber, regCode, visit, ok: false, error: `HTTP ${result.status}: ${result.snippet}` });
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
      await notifyAdminPassOrder({ user, carNumber, regCode, visit, ok: false, error: message });
      await sendMessage(chatId, `Ошибка: <pre>${message}</pre>`);
    }


    return res.status(200).json({ ok: true });
  } catch (err: any) {
    log('unexpected error', { error: err?.message });
    return res.status(200).json({ ok: true });
  }
}
  log('voice stt config', {
    keyPrefix: `${YANDEX_STT_API_KEY.slice(0, 4)}***`,
    folderId: YANDEX_STT_FOLDER_ID,
    lang: YANDEX_STT_LANG,
    topic: YANDEX_STT_TOPIC
  });
