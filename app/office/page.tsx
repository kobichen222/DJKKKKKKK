"use client";

import { useEffect, useMemo, useState } from "react";
import "./office.css";

/* ---------- constants ---------- */
const OFFICE_CODE = "KOBI2100";
const UNLOCK_KEY = "titan_office_unlocked_v1";
const SUPA_KEY = "djmaxai_supa_v1";
// Must stay in sync with SUPA_DEFAULT in public/index.html so the office
// panel and the main app read the same backend when localStorage is empty.
const SUPA_DEFAULT = {
  url: "https://eliimbfzegwcepbljdwp.supabase.co",
  anon: "sb_publishable_jBlBlUNP74IDyUYP8eldBg_elQu0-og",
};
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
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg?.url && cfg?.anon) return { url: cfg.url, anon: cfg.anon };
    }
  } catch {}
  return SUPA_DEFAULT;
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
export default function OfficePage() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [tab, setTab] = useState<Tab>("users");
  const [toast, setToast] = useState<Toast>(null);
  const [supa, setSupa] = useState<any>(null);
  const [supaErr, setSupaErr] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const cfg = readSupaCfg();
    if (!cfg) {
      setSupaErr("no-config");
      return;
    }
    (async () => {
      try {
        const sdk = await loadSupabaseUmd();
        const client = sdk.createClient(cfg.url, cfg.anon, {
          auth: { persistSession: true, autoRefreshToken: true },
        });
        setSupa(client);
      } catch (e: any) {
        setSupaErr(e?.message || "Supabase init failed");
      }
    })();
  }, [unlocked]);

  function notify(text: string, kind: "ok" | "err" = "ok") {
    const id = Date.now();
    setToast({ id, text, kind });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  }

  function submitCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.trim() === OFFICE_CODE) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      setUnlocked(true);
      setCodeErr("");
    } else {
      setCodeErr("✗ Invalid code");
      setCode("");
    }
  }

  function lock() {
    sessionStorage.removeItem(UNLOCK_KEY);
    setUnlocked(false);
    setCode("");
    setTab("users");
  }

  if (!mounted) return null;

  if (!unlocked) {
    return (
      <div className="office-shell">
        <form className="gate-wrap" onSubmit={submitCode}>
          <div className="gate-icon">🔒</div>
          <div className="gate-title">TITAN · OFFICE</div>
          <div className="gate-sub">Admin access code required</div>
          <input
            className="gate-input"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="— — — — — —"
            autoFocus
            autoComplete="off"
          />
          <div className="gate-err">{codeErr}</div>
          <button className="gate-btn" type="submit" disabled={!code}>
            UNLOCK
          </button>
        </form>
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
          <span>{supa ? "SUPABASE · CONNECTED" : supaErr === "no-config" ? "NO SUPABASE CONFIG" : "CONNECTING…"}</span>
          <button className="signout-btn" onClick={lock}>LOCK</button>
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

      {supaErr === "no-config" ? (
        <div className="office-panel">
          <div className="cfg-notice">
            <b>Supabase is not configured in this browser.</b> Open the main
            TITAN app → Settings → 🔐 AUTHENTICATION and paste your Project URL
            + anon key. Then run <code>public/auth.sql</code> and{" "}
            <code>public/office.sql</code> in Supabase SQL Editor. Return here
            and refresh.
          </div>
        </div>
      ) : !supa ? (
        <div className="office-panel">
          <div className="empty-state"><div className="big">⟳</div>Initialising Supabase…</div>
        </div>
      ) : (
        <>
          {tab === "users" && <UsersPanel supa={supa} notify={notify} />}
          {tab === "licenses" && <LicensesPanel supa={supa} notify={notify} />}
          {tab === "deals" && <DealsPanel supa={supa} notify={notify} />}
          {tab === "audit" && <AuditPanel supa={supa} />}
        </>
      )}

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

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Licenses are signed offline with the Ed25519 private key via
  // `node tools/gen-license.js`.  The admin pastes the resulting JSON here;
  // this panel verifies the signature with the embedded public key and then
  // records the license in Supabase for audit + revocation.  Signing in the
  // browser is deliberately impossible — the private key never leaves the
  // operator's machine.
  async function registerLicense() {
    const text = pastedJson.trim();
    if (!text) return notify("Paste the signed license JSON first", "err");

    let lic: SignedLicense;
    try {
      lic = JSON.parse(text) as SignedLicense;
    } catch {
      return notify("Not valid JSON — run tools/gen-license.js to produce it", "err");
    }

    setBusy(true);
    try {
      const ok = await verifySignedLicense(lic);
      if (!ok) {
        notify("Signature rejected — wrong key or tampered payload", "err");
        return;
      }
      const p = lic.payload;
      if (!p.email || !p.tier) {
        notify("Payload missing email or tier", "err");
        return;
      }

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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function create() {
    if (!code.trim()) return notify("Code required", "err");
    setBusy(true);
    try {
      const validUntil = validDays !== "" ? new Date(Date.now() + Number(validDays) * 86400000).toISOString() : null;
      const { data: userRes } = await supa.auth.getUser();
      const { error } = await supa.from("deals").insert({
        code: code.trim().toUpperCase(),
        title: title.trim() || null,
        kind,
        amount: Number(amount) || 0,
        max_uses: maxUses === "" ? null : Number(maxUses),
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
