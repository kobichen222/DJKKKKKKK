# TITAN Supabase Edge Functions

Server-side verification layer that closes holes a pure-client app can't
close. Each function lives in its own folder and deploys independently.

## verify-license

Moves license signature verification from the browser into a Deno edge worker
so a user can't bypass paid features by patching the renderer. Returns a
short-lived (24 h) HMAC token the client stores and sends on subsequent
calls to rate-limited endpoints.

### Deploy

```bash
# 1. Install the Supabase CLI once
npm i -g supabase

# 2. Log in and link the project
supabase login
supabase link --project-ref eliimbfzegwcepbljdwp

# 3. Set the secrets (never commit these)
supabase secrets set TITAN_LICENSE_PUBKEY_HEX=<your-ed25519-public-key-hex>
supabase secrets set TITAN_JWT_SECRET=<any-32-byte-random-string>

# 4. Deploy
supabase functions deploy verify-license
```

### Test

```bash
curl -X POST \
  https://eliimbfzegwcepbljdwp.supabase.co/functions/v1/verify-license \
  -H 'content-type: application/json' \
  -d '{"license":{"payload":{"user":"demo","plan":"pro","issuedAt":1700000000000,"expiresAt":9999999999999},"sig":"<hex>","alg":"ed25519"}}'
```

### Client integration

The existing `spVerifyLicense(...)` in `public/index.html` runs the same check
locally. That can stay as a fast-path for offline use, but any entitlement
that matters (premium downloads, unlimited decks, paid controllers) should
additionally require the server token. On the renderer:

```js
async function verifyLicenseServer(license) {
  const r = await fetch(`${supaCfg.url}/functions/v1/verify-license`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ license }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  localStorage.setItem('titan_entitlement', j.token);
  return j;
}
```
