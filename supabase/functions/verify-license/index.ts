// TITAN license verification — server-side Edge Function (Deno runtime)
//
// Why this exists:
//   The client-side Ed25519 check in index.html (spVerifyLicense) runs in the
//   user's browser, which means a motivated attacker can simply replace the
//   whole module to always return "valid". The only way to actually enforce
//   licensing is to verify server-side and return a short-lived token.
//
// Deploy:
//   supabase functions deploy verify-license
//
// Secrets (set once with `supabase secrets set`):
//   TITAN_LICENSE_PUBKEY_HEX  — the 32-byte Ed25519 public key, hex encoded.
//   TITAN_JWT_SECRET          — HMAC secret used to sign the short-lived
//                               entitlement token we hand back to the client.
//
// Request (POST JSON):
//   { license: { payload: {...}, sig: "<hex>", alg: "ed25519" } }
//
// Response:
//   200 { ok:true, expiresAt, plan, token }
//   401 { ok:false, error:"invalid-signature" | "expired" | "malformed" }
//
// The client should store the returned token, send it on subsequent
// requests, and refresh when it expires. Server-side enforcement means a
// DevTools patch on the renderer can no longer grant a free license.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

interface LicensePayload {
  user: string;
  plan: 'free' | 'pro' | 'team';
  issuedAt: number;
  expiresAt: number;
}
interface LicenseEnvelope {
  payload: LicensePayload;
  sig: string;
  alg?: string;
}

// ─── Rate limiting ──────────────────────────────────────────────────────────
// A naive in-memory token bucket per client IP. This survives only for the
// lifetime of the edge function isolate, which Supabase recycles often, but
// it raises the bar enough to block trivial brute-force loops and accidental
// retry storms from misconfigured clients. For sustained protection move to
// Deno.openKv() once it leaves beta.
const RL_WINDOW_MS = 60_000;            // 1 minute window
const RL_MAX_REQUESTS = 30;             // 30 verify attempts per IP per minute
const RL_MAX_TRACKED = 4096;            // hard cap on map entries (memory budget)
const rlBuckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  // Fall back to a constant key — better to share-rate-limit unknown
  // origins than to open the bucket entirely.
  return 'unknown';
}

function rateLimit(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const key = clientKey(req);
  let bucket = rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RL_WINDOW_MS };
    rlBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rlBuckets.size > RL_MAX_TRACKED) {
    // Drop the oldest entry — Map iteration is insertion-ordered, so the
    // first key is the oldest. This keeps the table bounded under DoS.
    const oldest = rlBuckets.keys().next().value;
    if (oldest && oldest !== key) rlBuckets.delete(oldest);
  }
  if (bucket.count > RL_MAX_REQUESTS) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

async function verifyEd25519(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'Ed25519' } as AlgorithmIdentifier,
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signatureHex),
      message,
    );
  } catch (_err) {
    return false;
  }
}

async function signHmacToken(secret: string, payload: object): Promise<string> {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  const b64 = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${b64}`;
}

serve(async (req) => {
  // CORS — browsers need this preflight for cross-origin calls
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method-not-allowed' }), {
      status: 405, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const rl = rateLimit(req);
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'rate-limited' }), {
      status: 429,
      headers: {
        ...corsHeaders,
        'content-type': 'application/json',
        'retry-after': String(rl.retryAfter),
      },
    });
  }

  const pubkey = Deno.env.get('TITAN_LICENSE_PUBKEY_HEX');
  const jwtSecret = Deno.env.get('TITAN_JWT_SECRET');
  if (!pubkey || !jwtSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'server-misconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  let body: { license?: LicenseEnvelope } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'malformed' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const lic = body.license;
  if (!lic || !lic.payload || !lic.sig) {
    return new Response(JSON.stringify({ ok: false, error: 'malformed' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
  if (lic.alg && lic.alg !== 'ed25519') {
    return new Response(JSON.stringify({ ok: false, error: 'alg-unsupported' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const enc = new TextEncoder();
  const message = enc.encode(JSON.stringify(lic.payload));
  const ok = await verifyEd25519(pubkey, message, lic.sig);
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid-signature' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const now = Date.now();
  if (typeof lic.payload.expiresAt === 'number' && lic.payload.expiresAt < now) {
    return new Response(JSON.stringify({ ok: false, error: 'expired' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  // Issue a 24-hour entitlement token. The client sends this on subsequent
  // calls (rate-limited endpoints, premium features) so we can verify the
  // license check happened here and not in a tampered renderer.
  const ttlMs = 24 * 60 * 60 * 1000;
  const tokenExp = Math.floor((now + ttlMs) / 1000);
  const token = await signHmacToken(jwtSecret, {
    sub: lic.payload.user,
    plan: lic.payload.plan,
    exp: tokenExp,
    iat: Math.floor(now / 1000),
  });

  return new Response(JSON.stringify({
    ok: true,
    plan: lic.payload.plan,
    expiresAt: lic.payload.expiresAt,
    token,
    tokenExpiresAt: tokenExp * 1000,
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
});
