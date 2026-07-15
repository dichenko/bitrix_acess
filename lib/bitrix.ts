
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import qs from 'qs';
import { env } from './env.js';

const BASE_URL = env('BASE_URL');
const LOGIN_PATH = env('LOGIN_PATH', '/auth.php');
const LOGIN_USER = env('LOGIN_USER');
const LOGIN_PASSWORD = env('LOGIN_PASSWORD');
const AFTER_LOGIN_BACKURL = env('AFTER_LOGIN_BACKURL', '/personal/access/');
const USER_AGENT = env('USER_AGENT', 'MikhailBot/1.0 (+vercel)');
const BITRIX_TIMEOUT_MS = Number(env('BITRIX_TIMEOUT_MS', '30000'));

if (!Number.isFinite(BITRIX_TIMEOUT_MS) || BITRIX_TIMEOUT_MS <= 0) {
  throw new Error('BITRIX_TIMEOUT_MS must be a positive number');
}

const FORM_CONST = {
  TYPE: env('TYPE', '1'),
  SPECIAL_TYPE_ANY_CAR: env('SPECIAL_TYPE_ANY_CAR', '1'),
  SELECT_HOUSE: env('SELECT_HOUSE'),
  SELECT_FLAT: env('SELECT_FLAT'),
  FIO: env('FIO'),
  PHONE: env('PHONE'),
  COMMENT: process.env['APP_COMMENT'] ?? process.env['COMMENT'] ?? '',
  AJAX_EDIT_TICKET: env('AJAX_EDIT_TICKET', 'true'),
  DEFAULT_RUS_CODE: env('DEFAULT_RUS_CODE', '000'),
};

function extractSessid(html: string): string {
  const $ = cheerio.load(html);
  const inputSessid = $('input[name="sessid"]').attr('value') || '';
  if (inputSessid) return inputSessid;

  const match = html.match(/bitrix_sessid["']?\s*[:=]\s*["']([a-f0-9]{32})["']/i);
  return match?.[1] ?? '';
}

export async function submitPass(params: {
  carInfo: string;
  number3: string;
  regCode?: string;
  visitAt?: string;
  comment?: string;
}) {
  try {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true, timeout: BITRIX_TIMEOUT_MS }));

    const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        const result = await fn();
        console.log('[bitrix]', step, 'ok', `${Date.now() - started}ms`);
        return result;
      } catch (err: any) {
        console.error('[bitrix]', step, 'failed', `${Date.now() - started}ms`, err?.code ?? '', err?.message ?? 'unknown');
        throw err;
      }
    };

    await timed('GET base', () => client.get(BASE_URL, { headers: { 'User-Agent': USER_AGENT } }));

    const loginBody = qs.stringify({
      AUTH_FORM: 'Y',
      TYPE: 'AUTH',
      USER_LOGIN: LOGIN_USER,
      USER_PASSWORD: LOGIN_PASSWORD,
      backurl: AFTER_LOGIN_BACKURL
    });

    const loginResp = await timed('POST login', () => client.post(new URL(LOGIN_PATH, BASE_URL).toString(), loginBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Origin': BASE_URL,
        'Referer': BASE_URL + '/'
      },
      maxRedirects: 5,
      timeout: BITRIX_TIMEOUT_MS,
      validateStatus: () => true
    }));

    if (loginResp.status >= 400) {
      throw new Error(`Ошибка логина: HTTP ${loginResp.status}`);
    }

    let accessStatus = loginResp.status;
    let html = String(loginResp.data);
    let sessid = extractSessid(html);

    if (!sessid) {
      const page = await timed('GET access', () => client.get(new URL('/personal/access/', BASE_URL).toString(), {
        headers: { 'User-Agent': USER_AGENT },
        timeout: BITRIX_TIMEOUT_MS,
        validateStatus: () => true
      }));
      accessStatus = page.status;
      html = String(page.data);
      sessid = extractSessid(html);
    } else {
      console.log('[bitrix]', 'sessid from login response');
    }

    if (!sessid) {
      const snippet = html.slice(0, 200);
      throw new Error(`Не удалось извлечь sessid со страницы /personal/access/. HTTP ${accessStatus}: ${snippet}`);
    }

    const form: Record<string,string> = {
      sessid,
      ID: '',
      TYPE: FORM_CONST.TYPE,
      STATUS: '',
      ACCOUNT_ID: '',
      SPECIAL_TYPE_ANY_CAR: FORM_CONST.SPECIAL_TYPE_ANY_CAR,
      WALKER_FIO: '',
      CAR_NUMBER_FOREIGN: '',
      CAR_NUMBER_RUS_NUMBER: params.number3,
      CAR_NUMBER_RUS_CODE: params.regCode ?? FORM_CONST.DEFAULT_RUS_CODE,
      CAR_INFO: params.carInfo,
      DATE_OF_VISITOR_CHECK_IN_EXPECTED: params.visitAt!,
      SELECT_HOUSE: FORM_CONST.SELECT_HOUSE,
      SELECT_FLAT: FORM_CONST.SELECT_FLAT,
      FIO: FORM_CONST.FIO,
      customer_phone: FORM_CONST.PHONE,
      PHONE: FORM_CONST.PHONE,
      COMMENT: params.comment ?? FORM_CONST.COMMENT,
      AJAX_EDIT_TICKET: FORM_CONST.AJAX_EDIT_TICKET
    };

    const body = qs.stringify(form);
    const resp = await timed('POST access form', () => client.post(new URL('/personal/access/', BASE_URL).toString(), body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Origin': BASE_URL,
        'Referer': new URL('/personal/access/', BASE_URL).toString(),
        'bx-ajax': 'true',
        'Accept': '*/*'
      },
      timeout: BITRIX_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true
    }));

    const snippet = typeof resp.data === 'string' ? resp.data.slice(0, 200) : JSON.stringify(resp.data).slice(0, 200);
    const ok = resp.status >= 200 && resp.status < 300;

    return {
      ok,
      status: resp.status,
      snippet,
      sent: {
        CAR_INFO: params.carInfo,
        CAR_NUMBER_RUS_NUMBER: params.number3,
        CAR_NUMBER_RUS_CODE: params.regCode ?? FORM_CONST.DEFAULT_RUS_CODE,
        DATE_OF_VISITOR_CHECK_IN_EXPECTED: params.visitAt
      }
    };
  } catch (err: any) {
    console.error('[submitPass] error', err?.message ?? err);
    throw err;
  }
}
