/**
 * open-kyber kotoba — SHEETS cell-formula evaluation (ADR-2606037200 D5). A small,
 * exact-decimal spreadsheet engine for the suite `sheet` object: cell references (A1),
 * ranges (A1:B3), the four operators with precedence + parentheses, and SUM/AVG/MIN/MAX/
 * COUNT. Pure (no substrate); the grid is the content-addressed `:suite.sheet/grid-cid`
 * block. `trialBalanceGrid` builds a live grid from the ERP trial balance — the concrete
 * suite↔ERP "連携・統合": a financial sheet whose totals are computed from Datom-log data.
 *
 * Arithmetic is exact decimal via money.ts (BigInt fixed-point); division/AVG round to 6 dp.
 */

import { divMoneyBy, mulMoney, subMoney, sumMoney } from "./money.js";

export interface Cell {
  formula?: string; // "=A1+B2", "=SUM(A1:A3)"
  value?: string; // literal (decimal string or text)
}
export type Grid = Record<string, Cell>;

export interface EvalResult {
  values: Record<string, string>; // addr → computed decimal string
  errors: Record<string, string>; // addr → error code (#CYCLE, #DIV/0, #REF, #PARSE)
}

const DP = 6;
const abs = (s: string) => (s.startsWith("-") ? s.slice(1) : s);
function cmp(a: string, b: string): number {
  const d = subMoney(a, b);
  return d === "0" ? 0 : d.startsWith("-") ? -1 : 1;
}
function decDiv(a: string, b: string): string {
  if (/^-?0+(\.0+)?$/.test(b)) throw new Error("#DIV/0");
  const neg = a.startsWith("-") !== b.startsWith("-");
  const q = divMoneyBy(abs(a), abs(b), DP);
  return neg && q !== "0" ? `-${q}` : q;
}

// ── address helpers ──────────────────────────────────────────────────────────
const ADDR_RE = /^([A-Z]+)([0-9]+)$/;
function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function expandRange(a: string, b: string): string[] {
  const ma = ADDR_RE.exec(a);
  const mb = ADDR_RE.exec(b);
  if (!ma || !mb) throw new Error("#REF");
  const c1 = colToNum(ma[1]);
  const c2 = colToNum(mb[1]);
  const r1 = Number(ma[2]);
  const r2 = Number(mb[2]);
  const out: string[] = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) out.push(`${numToCol(c)}${r}`);
  }
  return out;
}

// ── tokenizer ────────────────────────────────────────────────────────────────
type Tok = { t: "num" | "ref" | "func" | "op" | "lp" | "rp" | "comma" | "colon"; v: string };
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      // a function name is a word immediately followed by '('
      if (src[j] === "(") toks.push({ t: "func", v: word });
      else toks.push({ t: "ref", v: word });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", v: c }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", v: c }); i++; continue; }
    if (c === ":") { toks.push({ t: "colon", v: c }); i++; continue; }
    if ("+-*/".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new Error("#PARSE");
  }
  return toks;
}

// ── recursive-descent parser + evaluator ─────────────────────────────────────
function makeEvaluator(grid: Grid, resolve: (addr: string) => string) {
  function evalArgList(toks: Tok[], pos: { i: number }): string[] {
    // an argument may be a range (REF ':' REF) or a normal expression
    const args: string[] = [];
    if (toks[pos.i]?.t === "rp") return args;
    for (;;) {
      if (toks[pos.i]?.t === "ref" && toks[pos.i + 1]?.t === "colon" && toks[pos.i + 2]?.t === "ref") {
        const a = toks[pos.i].v;
        const b = toks[pos.i + 2].v;
        pos.i += 3;
        for (const addr of expandRange(a, b)) args.push(resolve(addr));
      } else {
        args.push(parseExpr(toks, pos));
      }
      if (toks[pos.i]?.t === "comma") { pos.i++; continue; }
      break;
    }
    return args;
  }
  function applyFunc(name: string, args: string[]): string {
    switch (name) {
      case "SUM": return sumMoney(args.length ? args : ["0"]);
      case "COUNT": return String(args.length);
      case "AVG": return args.length ? decDiv(sumMoney(args), String(args.length)) : "0";
      case "MIN": return args.length ? args.reduce((m, x) => (cmp(x, m) < 0 ? x : m)) : "0";
      case "MAX": return args.length ? args.reduce((m, x) => (cmp(x, m) > 0 ? x : m)) : "0";
      default: throw new Error("#PARSE");
    }
  }
  function parseFactor(toks: Tok[], pos: { i: number }): string {
    const tok = toks[pos.i];
    if (!tok) throw new Error("#PARSE");
    if (tok.t === "op" && tok.v === "-") { pos.i++; return subMoney("0", parseFactor(toks, pos)); }
    if (tok.t === "op" && tok.v === "+") { pos.i++; return parseFactor(toks, pos); }
    if (tok.t === "num") { pos.i++; return tok.v.includes(".") ? tok.v : tok.v; }
    if (tok.t === "lp") {
      pos.i++;
      const v = parseExpr(toks, pos);
      if (toks[pos.i]?.t !== "rp") throw new Error("#PARSE");
      pos.i++;
      return v;
    }
    if (tok.t === "func") {
      pos.i++; // name
      if (toks[pos.i]?.t !== "lp") throw new Error("#PARSE");
      pos.i++;
      const args = evalArgList(toks, pos);
      if (toks[pos.i]?.t !== "rp") throw new Error("#PARSE");
      pos.i++;
      return applyFunc(tok.v, args);
    }
    if (tok.t === "ref") { pos.i++; return resolve(tok.v); }
    throw new Error("#PARSE");
  }
  function parseTerm(toks: Tok[], pos: { i: number }): string {
    let v = parseFactor(toks, pos);
    while (toks[pos.i]?.t === "op" && (toks[pos.i].v === "*" || toks[pos.i].v === "/")) {
      const op = toks[pos.i].v;
      pos.i++;
      const rhs = parseFactor(toks, pos);
      v = op === "*" ? mulMoney(v, rhs) : decDiv(v, rhs);
    }
    return v;
  }
  function parseExpr(toks: Tok[], pos: { i: number }): string {
    let v = parseTerm(toks, pos);
    while (toks[pos.i]?.t === "op" && (toks[pos.i].v === "+" || toks[pos.i].v === "-")) {
      const op = toks[pos.i].v;
      pos.i++;
      const rhs = parseTerm(toks, pos);
      v = op === "+" ? sumMoney([v, rhs]) : subMoney(v, rhs);
    }
    return v;
  }
  return { parseExpr, evalArgList };
}

/** Evaluate every formula in the grid, resolving cell dependencies (cycle-safe). */
export function evaluateGrid(grid: Grid): EvalResult {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const inProgress = new Set<string>();
  const ev = makeEvaluator(grid, resolve);

  function literal(cell: Cell | undefined): string {
    if (!cell) return "0";
    if (cell.value !== undefined) return /^-?\d+(\.\d+)?$/.test(cell.value) ? cell.value : "0";
    return "0";
  }
  function resolve(addr: string): string {
    if (addr in values) return values[addr];
    if (inProgress.has(addr)) throw new Error("#CYCLE");
    const cell = grid[addr];
    if (!cell?.formula) return literal(cell);
    inProgress.add(addr);
    try {
      const src = cell.formula.startsWith("=") ? cell.formula.slice(1) : cell.formula;
      const toks = tokenize(src);
      const pos = { i: 0 };
      const v = ev.parseExpr(toks, pos);
      if (pos.i !== toks.length) throw new Error("#PARSE");
      values[addr] = v;
      return v;
    } finally {
      inProgress.delete(addr);
    }
  }

  for (const addr of Object.keys(grid)) {
    try {
      const cell = grid[addr];
      if (cell.formula) resolve(addr);
      else values[addr] = literal(cell);
    } catch (e) {
      errors[addr] = (e as Error).message.startsWith("#") ? (e as Error).message : "#PARSE";
    }
  }
  return { values, errors };
}
