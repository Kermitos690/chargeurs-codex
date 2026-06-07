// Shared test doubles for the automated integration harness.
// No network, no real Supabase, no real Stripe/ChargeNow. Everything runs
// in-process with deterministic fakes so business logic is exercised faithfully.

export type Row = Record<string, unknown>;

interface Filter { col: string; val: unknown; type: "eq" | "in"; }

// Minimal in-memory PostgREST-like query builder supporting the exact chains
// used by the edge functions under test:
//   from(t).insert(obj)                                  -> { error }
//   from(t).upsert(obj, {onConflict})                    -> { error }
//   from(t).update(obj).eq(col,val)                      -> { data, error }
//   from(t).select(cols).eq().in().order().limit()       -> { data }
class Builder {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private filters: Filter[] = [];
  private _limit?: number;
  constructor(private db: FakeDb, private table: string) {}

  insert(obj: Row) { this.op = "insert"; this.payload = obj; return this; }
  upsert(obj: Row) { this.op = "insert"; this.payload = obj; return this; }
  update(obj: Row) { this.op = "update"; this.payload = obj; return this; }
  select(_cols?: string) { if (this.op !== "insert") this.op = "select"; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, val, type: "eq" }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, val, type: "in" }); return this; }
  order() { return this; }
  limit(n: number) { this._limit = n; return this; }
  maybeSingle() { return this; }

  private match(): Row[] {
    const rows = this.db.tables[this.table] ?? [];
    return rows.filter((r) => this.filters.every((f) =>
      f.type === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col])));
  }

  private exec() {
    this.db.tables[this.table] ??= [];
    if (this.op === "insert") {
      const uniqueCol = this.db.uniqueCols[this.table];
      const p = this.payload!;
      if (uniqueCol && p[uniqueCol] != null) {
        const clash = this.db.tables[this.table].some((r) => r[uniqueCol] === p[uniqueCol]);
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      this.db.tables[this.table].push({ ...p });
      this.db.inserts.push({ table: this.table, row: { ...p } });
      return { data: [{ ...p }], error: null };
    }
    if (this.op === "update") {
      const matched = this.match();
      for (const r of matched) Object.assign(r, this.payload);
      this.db.updates.push({ table: this.table, count: matched.length, patch: { ...this.payload } });
      return { data: matched, error: null };
    }
    const out = this.match();
    return { data: this._limit ? out.slice(0, this._limit) : out, error: null };
  }

  then<T>(resolve: (v: { data: Row[] | null; error: { code?: string; message?: string } | null }) => T) {
    return Promise.resolve(this.exec()).then(resolve);
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  uniqueCols: Record<string, string> = {};
  inserts: { table: string; row: Row }[] = [];
  updates: { table: string; count: number; patch: Row }[] = [];
  from(table: string) { return new Builder(this, table); }
  seed(table: string, rows: Row[]) { this.tables[table] = rows.map((r) => ({ ...r })); }
}

// Build a Stripe-compatible signed webhook header (t=...,v1=HMAC_SHA256).
export async function signStripe(payload: string, secret: string, tsSeconds?: number): Promise<string> {
  const t = tsSeconds ?? Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const v1 = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${v1}`;
}

// Install a programmable fetch stub. Returns a restore fn. Records calls.
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
