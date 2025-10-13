
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

export async function submitPass(params: {
  carInfo: string;
  number3: string;
  regCode?: string;
  visitAt?: string;
  comment?: string;
}) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true, timeout: 12000 }));

  await client.get(BASE_URL, { headers: { 'User-Agent': USER_AGENT } });

  const loginBody = qs.stringify({
    AUTH_FORM: 'Y',
    TYPE: 'AUTH',
    USER_LOGIN: LOGIN_USER,
    USER_PASSWORD: LOGIN_PASSWORD,
    backurl: AFTER_LOGIN_BACKURL
  });

  const loginResp = await client.post(new URL(LOGIN_PATH, BASE_URL).toString(), loginBody, {
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

  if (loginResp.status >= 400) {
    throw new Error(`Ошибка логина: HTTP ${loginResp.status}`);
  }

  const page = await client.get(new URL('/personal/access/', BASE_URL).toString(), {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 12000
  });
  const html = String(page.data);
  const $ = cheerio.load(html);
  let sessid = $('input[name="sessid"]').attr('value') || '';
  if (!sessid) {
    const m = html.match(/bitrix_sessid["']?\s*[:=]\s*["']([a-f0-9]{32})["']/i);
    if (m) sessid = m[1];
  }
  if (!sessid) throw new Error('Не удалось извлечь sessid со страницы /personal/access/.');

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
}
