/**
 * Dethrone Control v1.4 — Backend protegido por PIN.
 *
 * NÃO salve os PINs no código ou no GitHub.
 * Configure no painel Supabase > Edge Functions > Secrets:
 *   ACCESS_PINS = os três PINs de 6 dígitos separados por vírgulas
 *   SESSION_SECRET = sequência aleatória de pelo menos 32 caracteres
 *
 * SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados pelo Supabase.
 * A mesma workspace 'main' é compartilhada por TODOS os três PINs.
 * Acesso direto às tabelas é bloqueado por RLS e revogação de privilégios.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const textEncoder = new TextEncoder();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '3600',
  'Vary': 'Origin',
};
const MAX_BODY_BYTES = 5_200_000;
const SESSION_MS = 24 * 60 * 60 * 1000;
const WORKSPACE = 'main';

type JsonRecord = Record<string, unknown>;

function respond(data: JsonRecord, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base64url(bytes: Uint8Array): string {
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function unbase64url(input: string): Uint8Array {
  const str = input.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(str.padEnd(Math.ceil(str.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
}
async function signSession(secret: string): Promise<string> {
  const claims = {
    aud: 'dethrone-control',
    exp: Date.now() + SESSION_MS,
    random: crypto.randomUUID(),
  };
  const body = base64url(textEncoder.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), textEncoder.encode(body)));
  return `${body}.${base64url(sig)}`;
}
async function validSession(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || parts[0].length > 2048 || parts[1].length > 256) return false;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64url(parts[1]), textEncoder.encode(parts[0]));
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
    return claims.aud === 'dethrone-control' && Number.isFinite(claims.exp) && claims.exp > Date.now();
  } catch { return false; }
}
async function validPin(input: string, configuredPins: string[]): Promise<boolean> {
  // Comparações por hash; os três PINs dão exatamente o mesmo acesso.
  const candidate = await digest(input);
  let ok = false;
  for (const pin of configuredPins) {
    const expected = await digest(pin);
    let different = 0;
    for (let i=0; i < candidate.length; i++) different |= candidate[i] ^ expected[i];
    if (different === 0) ok = true;
  }
  return ok;
}
function validPayload(data: unknown): data is JsonRecord {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as JsonRecord;
  return Array.isArray(d.clients) && d.clients.length <= 300 &&
    Array.isArray(d.logs) && d.logs.length <= 80000 &&
    Array.isArray(d.golems) && d.golems.length <= 150000;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const SESSION_SECRET = Deno.env.get('SESSION_SECRET') || '';
  const ACCESS_PINS = (Deno.env.get('ACCESS_PINS') || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SESSION_SECRET.length < 32 || ACCESS_PINS.length !== 3 || !ACCESS_PINS.every(v => /^\d{6}$/.test(v))) {
    return respond({ error: 'Configuração incompleta no Supabase. Confira os Secrets da Edge Function.' }, 503);
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const len = Number(req.headers.get('content-length') || '0');
    if (len > MAX_BODY_BYTES) return respond({ error: 'Arquivo de dados acima do limite de 5 MB.' }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return respond({ error: 'Arquivo de dados acima do limite de 5 MB.' }, 413);
    const body = JSON.parse(raw) as JsonRecord;
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') return respond({ error: 'Solicitação inválida.' }, 400);

    if (body.action === 'login') {
      const pin = String(body.pin ?? '');
      // Preferir IP confirmado pelo gateway, não um identificador enviado pelo navegador.
      const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown').slice(0, 128);
      const ipHash = base64url(await digest('dethrone-rate-v1:' + SESSION_SECRET + ':' + ip));
      const keys = [`ip_${ipHash}`, 'global'];
      for (const key of keys) {
        const { data, error } = await admin.rpc('dethrone_pin_guard', { p_key: key, p_success: null });
        if (error) throw error;
        if (data !== true) return respond({ error: 'Muitas tentativas. Aguarde e tente novamente.' }, 429);
      }
      const correct = /^\d{6}$/.test(pin) && await validPin(pin, ACCESS_PINS);
      for (const key of keys) {
        const { error } = await admin.rpc('dethrone_pin_guard', { p_key: key, p_success: correct });
        if (error) throw error;
      }
      if (!correct) return respond({ error: 'PIN incorreto.' }, 401);
      return respond({ ok: true, token: await signSession(SESSION_SECRET), expiresInSeconds: SESSION_MS / 1000 });
    }

    const authorization = req.headers.get('authorization') || '';
    const match = /^Bearer (.+)$/i.exec(authorization);
    if (!match || !(await validSession(match[1], SESSION_SECRET))) {
      return respond({ error: 'Sessão expirada. Entre com seu PIN novamente.' }, 401);
    }

    if (body.action === 'load') {
      const { data, error } = await admin.from('dethrone_workspace').select('data,revision,updated_at').eq('id',WORKSPACE).maybeSingle();
      if (error) throw error;
      return respond({ ok: true, revision: data?.revision ?? 0, payload: data?.data ?? null, updatedAt: data?.updated_at ?? null });
    }

    if (body.action === 'save') {
      const rev = Number(body.revision);
      const payload = body.payload;
      if (!Number.isSafeInteger(rev) || rev < 0 || !validPayload(payload)) return respond({ error: 'Dados ou versão inválidos.' }, 400);
      if (JSON.stringify(payload).length > 5_000_000) return respond({ error: 'Backup grande demais para sincronizar.' }, 413);

      if (rev === 0) {
        const { error } = await admin.from('dethrone_workspace').insert({ id: WORKSPACE, data: payload, revision: 1 });
        if (error && error.code !== '23505') throw error;
        if (error) return respond({ ok: false, conflict: true }, 409);
        return respond({ ok: true, revision: 1 });
      }
      const { data, error } = await admin.from('dethrone_workspace')
        .update({ data: payload, revision: rev + 1, updated_at: new Date().toISOString() })
        .eq('id', WORKSPACE).eq('revision', rev).select('revision').maybeSingle();
      if (error) throw error;
      if (!data) return respond({ ok: false, conflict: true }, 409);
      return respond({ ok: true, revision: data.revision });
    }
    return respond({ error: 'Ação desconhecida.' }, 400);
  } catch (error) {
    console.error('Dethrone Edge Function:', error);
    return respond({ error: 'Falha no servidor. Confira se o SQL foi executado e a função foi publicada.' }, 500);
  }
});
