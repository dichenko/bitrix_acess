import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { z } from 'zod';
import qs from 'qs';

const env = (k: string, d?: string) => {
  const v = process.env[`APP_${k}`] ?? process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env: ${k}`);
  return v!;
};

const BASE_URL = env('BASE_URL');
const LOGIN_PATH = env('LOGIN_PATH', '/auth.php');
const LOGIN_USER = env('LOGIN_USER');
const LOGIN_PASSWORD = env('LOGIN_PASSWORD');
const AFTER_LOGIN_BACKURL = env('AFTER_LOGIN_BACKURL', '/personal/access/');
const ACCESS_KEY = env('ACCESS_KEY');
const TZ = env('TZ', 'Europe/Moscow');
const USER_AGENT = env('USER_AGENT', 'MikhailBot/1.0 (+vercel)');

// Form constants
const FORM_CONST = {
  TYPE: env('TYPE', '1'),
  SPECIAL_TYPE_ANY_CAR: env('SPECIAL_TYPE_ANY_CAR', '1'),
  SELECT_HOUSE: env('SELECT_HOUSE'),
  SELECT_FLAT: env('SELECT_FLAT'),
  FIO: env('FIO'),
  PHONE: env('PHONE'),
  COMMENT: process.env['COMMENT'] ?? '',
  AJAX_EDIT_TICKET: env('AJAX_EDIT_TICKET', 'true'),
  DEFAULT_RUS_CODE: env('DEFAULT_RUS_CODE', '000'),
};

const bodySchema = z.object({
  text: z.string().min(2),
  reg_code: z.string().regex(/^\d{3}$/).optional(),
  visit_at: z.string().regex(/^\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}:\d{2}$/).optional(),
  comment: z.string().optional()
});

function parseMessage(msg: string): { carInfo: string; number3: string } {
  const m = msg.match(/\b(\d{3})\b/);
  if (!m) throw new Error('В сообщении должны быть ровно 3 цифры (например: "ауди 123" или "330 киа").');
  const number3 = m[1];
  const carInfo = msg.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
  if (!carInfo) throw new Error('Не найдено название марки/описание авто (CAR_INFO).');
  return { carInfo, number3 };
}

function formatVisitAt(s?: string): string {
  const zone = TZ;
  const dt = s
    ? DateTime.fromFormat(s, 'dd.MM.yyyy HH:mm:ss', { zone })
    : DateTime.now().setZone(zone).plus({ minutes: 5 });
  if (!dt.isValid) throw new Error('Неверный формат visit_at, нужен DD.MM.YYYY HH:mm:ss');
  return dt.toFormat('dd.MM.yyyy HH:mm:ss');
}

async function loginAndGetSessId(client: ReturnType<typeof wrapper>): Promise<string> {
  // 1) прогреть cookies
  await client.get(BASE_URL, { headers: { 'User-Agent': USER_AGENT } });

  // 2) логин
  const loginBody = qs.stringify({
    AUTH_FORM: 'Y',
    TYPE: 'AUTH',
    USER_LOGIN: LOGIN_USER,
    USER_PASSWORD: LOGIN_PASSWORD,
    backurl: AFTER_LOGIN_BACKURL
  });

  await client.post(new URL(LOGIN_PATH, BASE_URL).toString(), loginBody, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/'
    },
    maxRedirects: 5,
    timeout: 12000,
    validateStatus: () => true
  });

  // 3) получить страницу формы и вытащить sessid
  const { data: html } = await client.get(new URL('/personal/access/', BASE_URL).toString(), {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 12000
  });

  const $ = cheerio.load(html);
  let sessid = $('input[name="sessid"]').attr('value') || '';
  if (!sessid) {
    const m = String(html).match(/bitrix_sessid["']?\s*[:=]\s*["']([a-f0-9]{32})["']/i);
    if (m) sessid = m[1];
  }
  if (!sessid) throw new Error('Не удалось извлечь sessid со страницы /personal/access/.');
  return sessid;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    if (req.headers['x-access-key'] !== ACCESS_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { text, reg_code, visit_at, comment } = parsed.data;

    const { carInfo, number3 } = parseMessage(text);
    const visit = formatVisitAt(visit_at);
    const code3 = reg_code ?? FORM_CONST.DEFAULT_RUS_CODE;

    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true, timeout: 12000 }));

    const sessid = await loginAndGetSessId(client);

    // Сбор тела формы (ровно как в твоём дампе)
    const form: Record<string, string> = {
      sessid,
      ID: '',
      TYPE: FORM_CONST.TYPE,
      STATUS: '',
      ACCOUNT_ID: '',
      SPECIAL_TYPE_ANY_CAR: FORM_CONST.SPECIAL_TYPE_ANY_CAR,
      WALKER_FIO: '',
      CAR_NUMBER_FOREIGN: '',
      CAR_NUMBER_RUS_NUMBER: number3,
      CAR_NUMBER_RUS_CODE: code3,
      CAR_INFO: carInfo,
      DATE_OF_VISITOR_CHECK_IN_EXPECTED: visit,
      SELECT_HOUSE: FORM_CONST.SELECT_HOUSE,
      SELECT_FLAT: FORM_CONST.SELECT_FLAT,
      FIO: FORM_CONST.FIO,
      customer_phone: FORM_CONST.PHONE,
      PHONE: FORM_CONST.PHONE,
      COMMENT: comment ?? FORM_CONST.COMMENT,
      AJAX_EDIT_TICKET: FORM_CONST.AJAX_EDIT_TICKET
    };

    const body = qs.stringify(form);

    const resp = await client.post(new URL('/personal/access/', BASE_URL).toString(), body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Origin': BASE_URL,
        'Referer': new URL('/personal/access/', BASE_URL).toString(),
        'bx-ajax': 'true',
        'Accept': '*/*'
      },
      timeout: 12000,
      maxRedirects: 0,
      validateStatus: () => true
    });

    const { status, data } = resp;
    const snippet = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
    const ok = status >= 200 && status < 300;

    return res.status(ok ? 200 : 502).json({
      ok,
      httpStatus: status,
      sent: {
        CAR_INFO: carInfo,
        CAR_NUMBER_RUS_NUMBER: number3,
        CAR_NUMBER_RUS_CODE: code3,
        DATE_OF_VISITOR_CHECK_IN_EXPECTED: visit
      },
      rawSnippet: snippet
    });

  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    const isTimeout = /timeout|ECONN|ETIMEDOUT/i.test(msg);
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: msg });
  }
}
