/**
 * Runs demo invoice #1 (8 x 10,000 L tanks, R118,400.00) through the LIVE CivicProof
 * API exactly like the app will: supplier submits → municipality analyses, approves,
 * executes. In chain mode these are REAL, PERMANENT Fuji transactions.
 *
 *   cd contracts && npm run live:invoice1
 *
 * Reads from contracts/.env (git-ignored; never commit passwords):
 *   SUPABASE_URL           https://crshjvjrgnnypxbpjmob.supabase.co
 *   SUPABASE_ANON_KEY      Project Settings → API → anon/public key (browser-safe)
 *   SUPPLIER_EMAIL / SUPPLIER_PASSWORD
 *   MUNICIPALITY_EMAIL / MUNICIPALITY_PASSWORD
 *
 * Safe to re-run: it finds BB-001 on the active ledger and continues from its status.
 * The API itself never pays an invoice twice.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";

const URL_ = (process.env.SUPABASE_URL || "https://crshjvjrgnnypxbpjmob.supabase.co").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY;
const API = `${URL_}/functions/v1/civicproof-api`;

const CP001 = "10000000-0000-4000-8000-000000000001";
const BLUE_BASIN = "20000000-0000-4000-8000-000000000001";
const INVOICE = {
  project_id: CP001,
  supplier_id: BLUE_BASIN,
  invoice_number: "BB-001",
  invoice_date: "2026-11-18",
  total_cents: 11840000,
  line_items: [{ description: "10,000 L water tank", category: "water_storage", reference_sku: "TANK-10000L", quantity: 8, unit_price_cents: 1480000, line_total_cents: 11840000 }],
};

const rand = (cents) => `R${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const need = (k) => { if (!process.env[k]) throw new Error(`Set ${k} in contracts/.env`); return process.env[k]; };

async function login(role) {
  const email = need(`${role}_EMAIL`), password = need(`${role}_PASSWORD`);
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${role.toLowerCase()} login failed: ${j.error_description || j.msg || r.status}`);
  return j.access_token;
}

async function call(method, path, { token, json, form } = {}) {
  const headers = { apikey: ANON };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method, headers, body: form ?? (json !== undefined ? JSON.stringify(json) : undefined) });
  const j = await r.json().catch(() => ({ error: { code: "BAD_RESPONSE", message: `HTTP ${r.status}` } }));
  if (j.error) { const e = new Error(`${j.error.code}: ${j.error.message}`); e.code = j.error.code; throw e; }
  return { status: r.status, data: j.data };
}

const link = (d) => d?.explorer_url ? `  ↗ ${d.explorer_url}` : "";
const say = (msg) => console.log(msg);

async function main() {
  if (!ANON) throw new Error("Set SUPABASE_ANON_KEY in contracts/.env (Project Settings → API → anon public).");

  const { data: projects } = await call("GET", "/projects");
  const cp = projects.find((p) => p.id === CP001);
  if (!cp) throw new Error("CP001 not found");
  say(`Active ledger: ${cp.mode.toUpperCase()} · CP001 balance ${rand(cp.balance_cents)} · wallet ${cp.wallet_address ?? "(none)"}`);
  if (cp.mode === "simulated") say("⚠ Simulated mode is active: nothing will touch the chain.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = await rl.question(
    cp.mode === "simulated" ? "Run invoice #1 on the SIMULATED ledger? Type yes: "
      : `This makes REAL, PERMANENT ${cp.mode} transactions and pays R118,400.00 from CP001. Type yes: `);
  rl.close();
  if (ok.trim().toLowerCase() !== "yes") return say("Cancelled. Nothing was sent.");

  const supplier = await login("SUPPLIER");
  const municipality = await login("MUNICIPALITY");
  const me = (await call("GET", "/me", { token: municipality })).data;
  if (me.role !== "municipality") throw new Error(`MUNICIPALITY_EMAIL is a ${me.role} account`);
  say(`✓ logged in (supplier + municipality), mode ${me.wallet_mode}`);

  // Resume if BB-001 already exists on this ledger.
  let inv = cp.invoices.find((i) => i.invoice_number === INVOICE.invoice_number);
  if (inv) {
    say(`↺ BB-001 already exists (${inv.status}); continuing from there`);
  } else {
    const pdf = `%PDF-1.4\n% CivicProof demo invoice BB-001 - Blue Basin Tanks (Pty) Ltd - fictional\n% 8 x 10,000 L water tank @ R14,800.00 = R118,400.00\n%%EOF\n`;
    const form = new FormData();
    form.set("file", new Blob([pdf], { type: "application/pdf" }), "BB-001.pdf");
    form.set("invoice", JSON.stringify(INVOICE));
    const { status, data } = await call("POST", "/invoices", { token: supplier, form });
    inv = { id: data.id, status: data.status };
    say(`✓ 1/4 submitted BB-001 (${status === 202 ? "pending confirmation" : data.chain_status ?? "simulated"}) — document hash anchored${link(data)}`);
  }

  if (inv.status === "submitted") {
    const { data } = await call("POST", `/invoices/${inv.id}/analyse`, { token: municipality, json: {} });
    say(`✓ 2/4 analysed: recommendation ${data.recommendation}${data.flags?.length ? `, flags ${data.flags.join(", ")}` : ", no flags"}`);
    inv.status = "analysed";
    if (data.recommendation !== "APPROVE") return say("✋ Not approving automatically: the AI flagged it. Review it in the app.");
  }

  if (inv.status === "analysed" || inv.status === "on_hold") {
    const { data } = await call("POST", `/invoices/${inv.id}/approve`, { token: municipality, json: {} });
    say(`✓ 3/4 approved (${data.chain_status ?? data.status})${link(data)}`);
    if (data.chain_status === "pending") return say("⏳ Approval is still confirming. Run this again in a minute.");
    inv.status = "approved";
  }

  if (["approved", "payment_pending", "payment_failed"].includes(inv.status)) {
    const { status, data } = await call("POST", `/payments/${inv.id}/execute`, { token: municipality, json: {} });
    if (status === 202 || data.chain_status === "pending") {
      return say(`⏳ 4/4 payment sent, still confirming${link(data)}\n   Run this again in a minute: it will NOT pay twice.`);
    }
    say(`✓ 4/4 PAID R118,400.00 to Blue Basin Tanks${link(data)}`);
  } else if (inv.status === "paid") {
    say("✓ BB-001 was already paid.");
  }

  const after = (await call("GET", "/projects")).data.find((p) => p.id === CP001);
  say(`\nCP001 balance now ${rand(after.balance_cents)} (paid ${rand(after.paid_cents)})`);
  if (after.wallet_address && after.mode !== "simulated") {
    say(`Wallet on the explorer: https://testnet.${after.mode === "bsc" ? "bscscan.com" : "snowtrace.io"}/address/${after.wallet_address}`);
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
