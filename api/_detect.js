// Deterministic debt detectors. Same input → same monsters, so a rescan is a fair referee.
// detect(text, path) → [{ type, line, text }]
//
// Comments are found with a small string-aware scanner (not a regex), using the file's
// real comment syntax: "https://x.com/TODO" is a string, and `#TODO` in JS or CSS is not a comment.

const SYNTAX = {
  c:    { line: ["//"], block: [["/*", "*/"]] },             // JS/TS/Java/C/C#/Go/Rust/Swift/Kotlin/Dart/Scala/SCSS
  css:  { line: [], block: [["/*", "*/"]] },
  hash: { line: ["#"], block: [] },                           // Python/Ruby/Shell/YAML/TOML/R/Julia/Elixir
  php:  { line: ["//", "#"], block: [["/*", "*/"]] },
  dash: { line: ["--"], block: [] },                          // SQL/Lua/Haskell
  semi: { line: [";"], block: [] },                           // Clojure/Lisp
  html: { line: [], block: [["<!--", "-->"]] },
  sfc:  { line: ["//"], block: [["/*", "*/"], ["<!--", "-->"]] }, // Vue/Svelte
};
const EXT = {
  js: "c", jsx: "c", ts: "c", tsx: "c", mjs: "c", cjs: "c", java: "c", kt: "c", swift: "c", c: "c", h: "c",
  cc: "c", cpp: "c", hpp: "c", cs: "c", go: "c", rs: "c", scala: "c", dart: "c", m: "c", scss: "c",
  css: "css", py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yml: "hash", yaml: "hash",
  toml: "hash", r: "hash", jl: "hash", ex: "hash", exs: "hash", php: "php", sql: "dash", lua: "dash", hs: "dash",
  clj: "semi", html: "html", vue: "sfc", svelte: "sfc",
};
const syntaxFor = (path = "") => SYNTAX[EXT[(path.split(".").pop() || "").toLowerCase()]] || SYNTAX.c;
// Languages where ' is a char/lifetime, not reliably a string delimiter.
const NO_SINGLE_QUOTE = /\.(rs)$/i;

// Split every line into { code, comment } — strings stay in code, comments are pulled out.
export function splitComments(text, path = "") {
  const syn = syntaxFor(path);
  const quotes = NO_SINGLE_QUOTE.test(path) ? ['"', "`"] : ['"', "'", "`"];
  const lines = text.split("\n");
  const out = [];
  let block = null; // closing token while inside a block comment

  for (const line of lines) {
    let code = "", comment = "", i = 0, str = null;
    while (i < line.length) {
      if (block) {
        const end = line.indexOf(block, i);
        if (end === -1) { comment += line.slice(i); i = line.length; break; }
        comment += line.slice(i, end) + " ";
        i = end + block.length;
        block = null;
        continue;
      }
      const ch = line[i];
      if (str) {
        code += ch;
        if (ch === "\\") { code += line[i + 1] ?? ""; i += 2; continue; }
        if (ch === str) str = null;
        i++;
        continue;
      }
      if (quotes.includes(ch)) { str = ch; code += ch; i++; continue; }
      const lc = syn.line.find((t) => line.startsWith(t, i));
      if (lc) { comment += line.slice(i + lc.length); break; }
      const bc = syn.block.find(([open]) => line.startsWith(open, i));
      if (bc) { block = bc[1]; i += bc[0].length; continue; }
      code += ch;
      i++;
    }
    // Unclosed quote at end of line: treat as an apostrophe-style false start, not a multi-line string.
    out.push({ code, comment: comment.trim() });
  }
  return out;
}

// Explicit markers — uppercase, whole word, comments only.
const MARKERS = [
  { type: "FIXME", re: /\bFIXME\b/ },
  { type: "HACK", re: /\b(HACK|XXX)\b/ },
  { type: "TODO", re: /\bTODO\b/ },
];

// Placeholder language AI assistants commonly leave in comments.
const PLACEHOLDER = /\b(in a real (app|application|implementation|project|world|scenario)|in production,? (you|we) (would|should)|for now\b|placeholder|implement (this )?later|mock(ed)? data|dummy data|replace (this|with) (real|actual)|simplified (version|implementation)|not production[- ]ready)/i;

// Stubs: code that claims to exist but doesn't (checked against code, never comments).
const STUBS = [
  /\braise\s+NotImplementedError\b/,
  /\bthrow\s+new\s+Error\(\s*["'`]\s*not\s+implemented/i,
  /\bunimplemented!\s*\(/,
  /\btodo!\s*\(/,
  /\bthrow\s+new\s+(NotImplementedException|UnsupportedOperationException)\(\s*\)/,
  /\bpanic\(\s*["']not implemented/i,
];

// Abstract/interface methods raise NotImplementedError by design — that's not debt.
function isAbstractStub(parts, i) {
  for (let j = i - 1; j >= Math.max(0, i - 6); j--) if (/@(abc\.)?abstractmethod\b/.test(parts[j].code)) return true;
  for (let j = i - 1; j >= 0; j--) {
    const m = parts[j].code.match(/^\s*class\s+(\w+)\s*(\(([^)]*)\))?/);
    if (m) return /(Base|Abstract|Interface|Protocol|Mixin)/.test(m[1]) || /\b(ABC|ABCMeta)\b|Base|Abstract|Interface|Protocol/.test(m[3] || "");
  }
  return false;
}

const clean = (s) => s.replace(/^[\s:(\-\]\[*]+/, "").trim().slice(0, 160);

export function detect(text, path = "") {
  const parts = splitComments(text, path);
  const out = [];
  const push = (type, i, t) => out.push({ type, line: i + 1, text: clean(t) || "(no description — the scariest kind)" });

  for (let i = 0; i < parts.length; i++) {
    const { code, comment } = parts[i];
    const next = parts[i + 1]?.code ?? "";

    if (comment) {
      const marker = MARKERS.find((m) => m.re.test(comment));
      if (marker) { push(marker.type, i, comment.split(marker.re).pop()); continue; }
      if (PLACEHOLDER.test(comment)) { push("PLACEHOLDER", i, comment); continue; }
    }
    if (STUBS.some((re) => re.test(code)) && !isAbstractStub(parts, i)) { push("STUB", i, code.trim()); continue; }

    // A swallow with an explanation (catch { /* ignore: ... */ }) is documented, not silent.
    const explained = !!comment || !!parts[i + 1]?.comment;

    // Silent exceptions — JS/TS/Java/C#: catch (...) {}  or  catch (...) {\n}
    if (explained) continue;
    if (/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/.test(code)) { push("SILENT", i, code.trim()); continue; }
    if (/\bcatch\s*(\([^)]*\))?\s*\{\s*$/.test(code) && /^\s*\}/.test(next)) { push("SILENT", i, `${code.trim()} }`); continue; }
    // Python: except...: pass  or  except...:\n    pass
    // Python: only broad swallows (bare except / Exception / BaseException) — `except FileNotFoundError: pass` is a deliberate idiom.
    const BROAD = /^\s*except\s*(\(?\s*(Exception|BaseException)\s*\)?)?\s*(as\s+\w+)?\s*:/;
    if (BROAD.test(code) && /:\s*pass\s*$/.test(code)) { push("SILENT", i, code.trim()); continue; }
    if (BROAD.test(code) && /:\s*$/.test(code) && /^\s*pass\s*$/.test(next)) push("SILENT", i, `${code.trim()} pass`);
  }
  return out;
}
