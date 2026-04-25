"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import "./office.css";

/* ---------- runtime validation schemas ---------- */
// All untrusted form input crosses these schemas before touching Supabase.
// Zod gives us (a) precise error messages instead of silent .insert failures
// when the DB constraint trips, and (b) a single source of truth for shape
// that the TypeScript types are derived from.
const LicensePayloadSchema = z.object({
  tier: z.string().min(1, "tier is required"),
  email: z.string().email("payload email is not a valid address"),
  expiresAt: z.number().int().nullable(),
  issuedAt: z.number().int().optional(),
});

const SignedLicenseSchema = z.object({
  payload: LicensePayloadSchema,
  sig: z.string().regex(/^[0-9a-fA-F]+$/, "sig must be hex").min(2),
  alg: z.literal("ed25519").optional(),
});

const DealKind = z.enum(["percent", "fixed", "bundle", "free-month"]);
const DealFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "code must be at least 2 characters")
      .max(40, "code must be 40 characters or fewer")
      .regex(/^[A-Z0-9_-]+$/, "code may only contain A-Z, 0-9, _ and -"),
    title: z.string().trim().max(120).optional(),
    kind: DealKind,
    amount: z.number().min(0, "amount cannot be negative"),
    maxUses: z.number().int().min(1).nullable(),
    validDays: z.number().int().min(1).nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && d.amount > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "percent discount cannot exceed 100",
      });
    }
  });

/* ---------- constants ---------- */
// Office access is gated by Supabase auth + profiles.role === 'admin'.
// The previous hardcoded unlock string was readable in the bundled JS,
// so anyone could open the panel; the smoke test in src/__tests__/smoke.test.ts
// guards the renderer against its return — this file is now the second
// half of that promise.
const SUPA_KEY = "djmaxai_supa_v1";
// Ed25519 public key (32 bytes, hex) — must match SP_LICENSE_PUBKEY_HEX in
// public/index.html.  The matching private key lives only on the operator's
// machine (tools/titan-private.pem); licenses are signed offline via
// `node tools/gen-license.js` and pasted into this panel for registration.
const SP_LICENSE_PUBKEY_HEX = "a1263d3bdc8c59791c47c017a4f7e2b34580d61d4a3b97fa12a9fd744e1b60af";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

/* ---------- types ---------- */
type Tab = "users" | "licenses" | "deals" | "audit";
type Toast = { id: number; text: string; kind: "ok" | "err" } | null;
type Profile = { id: string; email: string; name: string | null; role: "user" | "admin"; banned: boolean; created_at: string; last_login: string };
type License = { id: string; email: string; tier: string; issued_at: string; expires_at: string | null; revoked: boolean; notes: string | null };
type Deal = { id: string; code: string; title: string | null; kind: string; amount: number; valid_until: string | null; max_uses: number | null; used_count: number; active: boolean };
type AuditRow = { id: string; actor_email: string | null; action: string; target_type: string | null; target_id: string | null; created_at: string };

/* ---------- dynamic-load Supabase UMD (same pattern as main app) ---------- */
async function loadSupabaseUmd(): Promise<any> {
  if (typeof window === "undefined") return null;
  if ((window as any).supabase?.createClient) return (window as any).supabase;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SUPABASE_CDN;
    s.onload = () => resolve((window as any).supabase);
    s.onerror = () => reject(new Error("Supabase SDK load failed"));
    document.head.appendChild(s);
  });
}

function readSupaCfg(): { url: string; anon: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUPA_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg?.url && cfg?.anon) return { url: cfg.url, anon: cfg.anon };
  } catch {}
  return null;
}

/* ---------- Ed25519 verify (paired with tools/gen-license.js) ---------- */
type SignedLicense = {
  payload: { tier: string; email: string; expiresAt: number | null; issuedAt?: number };
  sig: string;
  alg?: string;
};

let _pubkeyPromise: Promise<CryptoKey> | null = null;
function importPubkey(): Promise<CryptoKey> {
  if (_pubkeyPromise) return _pubkeyPromise;
  const raw = new Uint8Array(
    (SP_LICENSE_PUBKEY_HEX.match(/.{2}/g) || []).map((h) => parseInt(h, 16))
  );
  _pubkeyPromise = crypto.subtle.importKey(
    "raw",
    raw,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return _pubkeyPromise;
}

async function verifySignedLicense(lic: SignedLicense): Promise<boolean> {
  try {
    if (!lic || !lic.payload || !lic.sig) return false;
    if (lic.alg && lic.alg !== "ed25519") return false;
    const pubkey = await importPubkey();
    const text = new TextEncoder().encode(JSON.stringify(lic.payload));
    const sig = new Uint8Array(
      (lic.sig.match(/.{2}/g) || []).map((h) => parseInt(h, 16))
    );
    return await crypto.subtle.verify({ name: "Ed25519" }, pubkey, sig, text);
  } catch {
    return false;
  }
}

/* =============================================================
 * PAGE
 * ============================================================= */
type AuthStatus =
  | "checking"
  | "no-config"
  | "signed-out"
  | "not-admin"
  | "banned"
  | "error"
  | "ready";

export default function OfficePage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("users");
  const [toast, setToast] = useState<Toast>(null);
  const [supa, setSupa] = useState<any>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Single auth/role check on mount. We deliberately do NOT offer a sign-in
  // UI here — sign-in goes through the main TITAN app so there is one
  // identity flow to audit.  This panel is read-only on auth state.
  useEffect(() => {
    if (!mounted) return;
    const cfg = readSupaCfg();
    if (!cfg) {
      setAuthStatus("no-config");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sdk = await loadSupabaseUmd();
        const client = sdk.createClient(cfg.url, cfg.anon, {
          auth: { persistSession: true, autoRefreshToken: true },
        });
        if (cancelled) return;
        setSupa(client);
        await refreshAuth(client);
      } catch (e: any) {
        if (cancelled) return;
        setAuthStatus("error");
        setAuthError(e?.message || "Supabase init failed");
      }
    })();
    return () => { cancelled = true; };
  }, [mounted]);

  async function refreshAuth(client: any) {
    const { data: userRes, error: userErr } = await client.auth.getUser();
    if (userErr || !userRes?.user) {
      setAuthStatus("signed-out");
      setAuthEmail("");
      return;
    }
    const u = userRes.user;
    setAuthEmail(u.email ?? "");
    const { data: profile, error: profileErr } = await client
      .from("profiles")
      .select("role,banned")
      .eq("id", u.id)
      .maybeSingle();
    if (profileErr) {
      setAuthStatus("error");
      setAuthError(profileErr.message);
      return;
    }
    if (!profile) {
      setAuthStatus("not-admin");
      return;
    }
    if (profile.banned) {
      setAuthStatus("banned");
      return;
    }
    if (profile.role !== "admin") {
      setAuthStatus("not-admin");
      return;
    }
    setAuthStatus("ready");
  }

  function notify(text: string, kind: "ok" | "err" = "ok") {
    const id = Date.now();
    setToast({ id, text, kind });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  }

  async function signOut() {
    if (supa) await supa.auth.signOut();
    setAuthStatus("signed-out");
    setAuthEmail("");
    setTab("users");
  }

  if (!mounted) return null;

  if (authStatus !== "ready") {
    return (
      <div className="office-shell">
        <div className="gate-wrap">
          <div className="gate-icon">
            {authStatus === "checking" ? "⟳" :
             authStatus === "no-config" ? "⚙" :
             authStatus === "signed-out" ? "🔑" :
             authStatus === "banned" ? "⛔" :
             authStatus === "error" ? "✗" : "🔒"}
          </div>
          <div className="gate-title">TITAN · OFFICE</div>
          <div className="gate-sub">
            {authStatus === "checking" && "Checking your session…"}
            {authStatus === "no-config" && (
              <>Supabase not configured. Open the main TITAN app → Settings → 🔐 AUTHENTICATION, paste your Project URL + anon key, then return here.</>
            )}
            {authStatus === "signed-out" && (
              <>You are not signed in. Sign in via the main TITAN app, then return to this page.</>
            )}
            {authStatus === "not-admin" && (
              <>Access denied for <code>{authEmail || "(no email)"}</code>. Admin role required.</>
            )}
            {authStatus === "banned" && (
              <>Account suspended. Contact the platform owner.</>
            )}
            {authStatus === "error" && (
              <>Auth check failed: <code>{authError}</code></>
            )}
          </div>
          {supa && (authStatus === "not-admin" || authStatus === "banned") && (
            <button className="gate-btn" type="button" onClick={signOut}>
              SIGN OUT
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="office-shell">
      <header className="office-header">
        <div className="office-brand">
          TITAN · <span className="accent">OFFICE</span>
        </div>
        <div className="office-status">
          <span>
            <span className="dot" /> LIVE
          </span>
          <span>SUPABASE · CONNECTED</span>
          <span title={authEmail}>{authEmail || "admin"}</span>
          <button className="signout-btn" onClick={signOut}>SIGN OUT</button>
        </div>
      </header>

      <nav className="office-tabs" role="tablist">
        {(["users", "licenses", "deals", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`office-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "users" && "👥 USERS"}
            {t === "licenses" && "🔑 LICENSES"}
            {t === "deals" && "🎟 DEALS"}
            {t === "audit" && "📜 AUDIT"}
          </button>
        ))}
      </nav>

      {tab === "users" && <UsersPanel supa={supa} notify={notify} />}
      {tab === "licenses" && <LicensesPanel supa={supa} notify={notify} />}
      {tab === "deals" && <DealsPanel supa={supa} notify={notify} />}
      {tab === "audit" && <AuditPanel supa={supa} />}

      {toast && <div className={`toast-bar ${toast.kind === "err" ? "err" : ""}`}>{toast.text}</div>}
    </div>
  );
}

/* =============================================================
 * USERS PANEL
 * ============================================================= */
function UsersPanel({ supa, notify }: { supa: any; notify: (t: string, k?: "ok" | "err") => void }) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supa
      .from("profiles")
      .select("id,email,name,role,banned,created_at,last_login")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      notify(error.message || "Failed to load users", "err");
      return;
    }
    setRows((data || []) as Profile[]);
  }

  useEffect(() => { load(); }, []);

  async function audit(action: string, target_id: string, details: object = {}) {
    const { data: userRes } = await supa.auth.getUser();
    const u = userRes?.user;
    await supa.from("admin_audit").insert({
      actor_id: u?.id || null,
      actor_email: u?.email || null,
      action,
      target_type: "profile",
      target_id,
      details,
    });
  }

  async function setRole(id: string, role: "user" | "admin") {
    const { error } = await supa.from("profiles").update({ role }).eq("id", id);
    if (error) return notify(error.message, "err");
    audit(role === "admin" ? "promote_admin" : "demote_user", id, { role });
    notify(`Role updated → ${role}`);
    load();
  }
  async function setBanned(id: string, banned: boolean) {
    const { error } = await supa.from("profiles").update({ banned }).eq("id", id);
    if (error) return notify(error.message, "err");
    audit(banned ? "ban_user" : "unban_user", id);
    notify(banned ? "User banned" : "User unbanned");
    load();
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(
      (r) => (r.email || "").toLowerCase().includes(qq) || (r.name || "").toLowerCase().includes(qq)
    );
  }, [q, rows]);

  return (
    <section className="office-panel">
      <div className="panel-head">
        <div className="panel-title">👥 USERS</div>
        <div className="panel-count">{filtered.length} / {rows.length}</div>
      </div>
      <div className="search-row">
        <input className="search-input" placeholder="Search by email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "⟳ LOADING" : "⟳ REFRESH"}
        </button>
      </div>

      {!filtered.length ? (
        <div className="empty-state"><div className="big">🔍</div>No users match the filter</div>
      ) : (
        <div className="office-table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>{u.email || "—"}</td>
                  <td>{u.name || "—"}</td>
                  <td><span className={`badge ${u.role}`}>{u.role}</span></td>
                  <td>
                    {u.banned ? <span className="badge danger">BANNED</span> : <span className="badge ok">ACTIVE</span>}
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>{fmtDate(u.last_login)}</td>
                  <td>
                    <div className="tbl-actions">
                      {u.role === "admin" ? (
                        <button className="btn-secondary" onClick={() => setRole(u.id, "user")}>↓ DEMOTE</button>
                      ) : (
                        <button className="btn-primary" onClick={() => setRole(u.id, "admin")}>↑ ADMIN</button>
                      )}
                      {u.banned ? (
                        <button className="btn-warn" onClick={() => setBanned(u.id, false)}>UNBAN</button>
                      ) : (
                        <button className="btn-danger" onClick={() => setBanned(u.id, true)}>BAN</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =============================================================
 * LICENSES PANEL
 * ============================================================= */
function LicensesPanel({ supa, notify }: { supa: any; notify: (t: string, k?: "ok" | "err") => void }) {
  const [rows, setRows] = useState<License[]>([]);
  const [pastedJson, setPastedJson] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>("");

  async function load() {
    const { data, error } = await supa
      .from("licenses")
      .select("id,email,tier,issued_at,expires_at,revoked,notes")
      .order("issued_at", { ascending: false })
      .limit(500);
    if (error) { notify(error.message, "err"); return; }
    setRows((data || []) as License[]);
  }
  useEffect(() => { load(); }, []);

  // Licenses are signed offline with the Ed25519 private key via
  // `node tools/gen-license.js`.  The admin pastes the resulting JSON here;
  // this panel verifies the signature with the embedded public key and then
  // records the license in Supabase for audit + revocation.  Signing in the
  // browser is deliberately impossible — the private key never leaves the
  // operator's machine.
  async function registerLicense() {
    const text = pastedJson.trim();
    if (!text) return notify("Paste the signed license JSON first", "err");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return notify("Not valid JSON — run tools/gen-license.js to produce it", "err");
    }

    const result = SignedLicenseSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first?.path.join(".") || "root";
      const msg = first?.message || "schema validation failed";
      return notify(`Bad license shape (${where}): ${msg}`, "err");
    }
    const lic = result.data;

    setBusy(true);
    try {
      const ok = await verifySignedLicense(lic);
      if (!ok) {
        notify("Signature rejected — wrong key or tampered payload", "err");
        return;
      }
      const p = lic.payload;

      const { data: userRes } = await supa.auth.getUser();
      const { data, error } = await supa
        .from("licenses")
        .insert({
          email: p.email,
          tier: p.tier,
          expires_at: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
          payload: p,
          signature: lic.sig,
          notes: notes.trim() || null,
          created_by: userRes?.user?.id || null,
        })
        .select()
        .single();
      if (error) throw error;

      await supa.from("admin_audit").insert({
        actor_id: userRes?.user?.id || null,
        actor_email: userRes?.user?.email || null,
        action: "register_license",
        target_type: "license",
        target_id: data?.id || null,
        details: { tier: p.tier, email: p.email, expiresAt: p.expiresAt },
      });

      setPreview(JSON.stringify(lic, null, 2));
      setPastedJson("");
      setNotes("");
      notify(`Registered: ${p.tier} for ${p.email}`);
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to register", "err");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const { error } = await supa.from("licenses").update({ revoked: true, revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return notify(error.message, "err");
    notify("License revoked");
    load();
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify("Copied to clipboard"); }
    catch { notify("Copy failed — select and copy manually", "err"); }
  }

  return (
    <section className="office-panel">
      <div className="panel-head">
        <div className="panel-title">🔑 LICENSE REGISTRY</div>
        <div className="panel-count">{rows.length} on file</div>
      </div>

      <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.6, margin: "4px 0 12px" }}>
        Licenses are signed offline by the key holder:
        <br />
        <code style={{ color: "#ffd089" }}>
          node tools/gen-license.js --key titan-private.pem --email buyer@example.com --tier pro --days 365
        </code>
        <br />
        Paste the resulting JSON below to verify the signature and log it to Supabase for audit + revocation tracking.
      </div>

      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>SIGNED LICENSE JSON
          <textarea
            rows={8}
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
            placeholder='{"payload":{"tier":"pro","email":"buyer@example.com","expiresAt":...,"issuedAt":...},"sig":"...","alg":"ed25519"}'
            style={{ fontFamily: "monospace", fontSize: 12, width: "100%" }}
          />
        </label>
        <label>NOTES
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal note" />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={registerLicense} disabled={busy}>
          {busy ? "⟳ VERIFYING" : "✓ VERIFY + REGISTER"}
        </button>
        {preview && <button className="btn-secondary" onClick={() => copy(preview)}>📋 COPY JSON</button>}
      </div>

      {preview && <pre className="license-output">{preview}</pre>}

      <div className="panel-head" style={{ marginTop: 20 }}>
        <div className="panel-title">ISSUED</div>
        <div className="panel-count">Recent 500</div>
      </div>
      {!rows.length ? (
        <div className="empty-state"><div className="big">📭</div>No licenses issued yet</div>
      ) : (
        <div className="office-table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Tier</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const expired = l.expires_at && Date.parse(l.expires_at) < Date.now();
                return (
                  <tr key={l.id}>
                    <td>{l.email}</td>
                    <td><span className="badge admin">{l.tier}</span></td>
                    <td>{fmtDate(l.issued_at)}</td>
                    <td>{l.expires_at ? fmtDate(l.expires_at) : "—"}</td>
                    <td>
                      {l.revoked ? <span className="badge danger">REVOKED</span>
                        : expired ? <span className="badge warn">EXPIRED</span>
                        : <span className="badge ok">ACTIVE</span>}
                    </td>
                    <td>{l.notes || "—"}</td>
                    <td>
                      <div className="tbl-actions">
                        {!l.revoked && <button className="btn-danger" onClick={() => revoke(l.id)}>REVOKE</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =============================================================
 * DEALS PANEL
 * ============================================================= */
function DealsPanel({ supa, notify }: { supa: any; notify: (t: string, k?: "ok" | "err") => void }) {
  const [rows, setRows] = useState<Deal[]>([]);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed" | "bundle" | "free-month">("percent");
  const [amount, setAmount] = useState(10);
  const [maxUses, setMaxUses] = useState<number | "">("");
  const [validDays, setValidDays] = useState<number | "">(30);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supa
      .from("deals")
      .select("id,code,title,kind,amount,valid_until,max_uses,used_count,active")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { notify(error.message, "err"); return; }
    setRows((data || []) as Deal[]);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const candidate = {
      code: code.trim().toUpperCase(),
      title: title.trim() || undefined,
      kind,
      amount: Number(amount),
      maxUses: maxUses === "" ? null : Number(maxUses),
      validDays: validDays === "" ? null : Number(validDays),
    };
    const parsed = DealFormSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return notify(first?.message || "Invalid deal", "err");
    }
    const v = parsed.data;
    setBusy(true);
    try {
      const validUntil = v.validDays
        ? new Date(Date.now() + v.validDays * 86_400_000).toISOString()
        : null;
      const { data: userRes } = await supa.auth.getUser();
      const { error } = await supa.from("deals").insert({
        code: v.code,
        title: v.title ?? null,
        kind: v.kind,
        amount: v.amount,
        max_uses: v.maxUses,
        valid_until: validUntil,
        active: true,
        created_by: userRes?.user?.id || null,
      });
      if (error) throw error;
      await supa.from("admin_audit").insert({
        actor_id: userRes?.user?.id || null,
        actor_email: userRes?.user?.email || null,
        action: "create_deal",
        target_type: "deal",
        details: { code: code.trim().toUpperCase(), kind, amount },
      });
      notify(`Deal ${code.toUpperCase()} created`);
      setCode(""); setTitle("");
      load();
    } catch (e: any) {
      notify(e?.message || "Failed to create", "err");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(id: string, active: boolean) {
    const { error } = await supa.from("deals").update({ active }).eq("id", id);
    if (error) return notify(error.message, "err");
    notify(active ? "Activated" : "Deactivated");
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this deal permanently?")) return;
    const { error } = await supa.from("deals").delete().eq("id", id);
    if (error) return notify(error.message, "err");
    notify("Deal deleted");
    load();
  }

  return (
    <section className="office-panel">
      <div className="panel-head">
        <div className="panel-title">🎟 NEW DEAL</div>
      </div>
      <div className="form-grid">
        <label>CODE
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER25" style={{ textTransform: "uppercase" }} />
        </label>
        <label>TITLE
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer special" />
        </label>
        <label>KIND
          <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed amount</option>
            <option value="bundle">Bundle</option>
            <option value="free-month">Free month</option>
          </select>
        </label>
        <label>AMOUNT
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
        </label>
        <label>MAX USES
          <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value) || 1))} placeholder="Unlimited" />
        </label>
        <label>VALID (DAYS)
          <input type="number" min={1} value={validDays} onChange={(e) => setValidDays(e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value) || 1))} placeholder="No limit" />
        </label>
      </div>
      <button className="btn-primary" onClick={create} disabled={busy}>
        {busy ? "⟳ CREATING" : "⚡ CREATE DEAL"}
      </button>

      <div className="panel-head" style={{ marginTop: 20 }}>
        <div className="panel-title">ACTIVE CATALOG</div>
        <div className="panel-count">{rows.length} total</div>
      </div>
      {!rows.length ? (
        <div className="empty-state"><div className="big">🎟</div>No deals yet</div>
      ) : (
        <div className="office-table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Kind</th>
                <th>Amount</th>
                <th>Uses</th>
                <th>Valid until</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontFamily: "'Share Tech Mono',monospace", color: "var(--cyan-soft)" }}>{d.code}</td>
                  <td>{d.title || "—"}</td>
                  <td><span className="badge user">{d.kind}</span></td>
                  <td>{d.kind === "percent" ? `${d.amount}%` : d.amount}</td>
                  <td>{d.used_count}{d.max_uses ? ` / ${d.max_uses}` : ""}</td>
                  <td>{d.valid_until ? fmtDate(d.valid_until) : "∞"}</td>
                  <td>{d.active ? <span className="badge ok">ON</span> : <span className="badge warn">OFF</span>}</td>
                  <td>
                    <div className="tbl-actions">
                      <button className={d.active ? "btn-warn" : "btn-primary"} onClick={() => toggle(d.id, !d.active)}>
                        {d.active ? "DISABLE" : "ENABLE"}
                      </button>
                      <button className="btn-danger" onClick={() => remove(d.id)}>DELETE</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =============================================================
 * AUDIT PANEL
 * ============================================================= */
function AuditPanel({ supa }: { supa: any }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supa
        .from("admin_audit")
        .select("id,actor_email,action,target_type,target_id,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data || []) as AuditRow[]);
      setLoading(false);
    })();
  }, [supa]);

  return (
    <section className="office-panel">
      <div className="panel-head">
        <div className="panel-title">📜 AUDIT LOG</div>
        <div className="panel-count">{rows.length} events</div>
      </div>
      {loading ? (
        <div className="empty-state"><div className="big">⟳</div>Loading…</div>
      ) : !rows.length ? (
        <div className="empty-state"><div className="big">📭</div>No admin actions recorded yet</div>
      ) : (
        <div className="office-table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "'Share Tech Mono',monospace", whiteSpace: "nowrap" }}>{fmtDate(r.created_at, true)}</td>
                  <td>{r.actor_email || "—"}</td>
                  <td><span className="badge admin">{r.action}</span></td>
                  <td style={{ color: "var(--text-dim)" }}>{r.target_type || "—"}{r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- util ---------- */
function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}
