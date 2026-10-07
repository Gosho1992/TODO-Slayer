// TODO Slayer — repo scanner
// GET /api/scan?repo=owner/name  (or a full GitHub URL)
// Returns every TODO/FIXME in the repo as a monster, with git-blame age when GITHUB_TOKEN is set.

const SKIP_DIRS = /(^|\/)(node_modules|dist|build|vendor|\.git|\.next|coverage|out|target|__pycache__|\.venv|venv)\//;
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|scala|sh|bash|zsh|sql|lua|dart|vue|svelte|html|css|scss|yml|yaml|toml|r|jl|ex|exs|clj|hs|ml|m)$/i;
const SKIP_FILES = /(\.min\.|package-lock\.json|yarn\.lock|pnpm-lock)/;
const MAX_FILES = 250;
const MAX_MONSTERS = 60;
import { detect } from "./_detect.js";
import { enrichMonsters } from "./_monsters.js";

const gh = (path, token) =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "todo-slayer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

export function parseRepo(input) {
  const s = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

// Stable identity for a TODO: file + normalized text. Line numbers shift, so they're not part of it.
function monsterId(file, tag, text) {
  const key = `${file}|${tag}|${text.toLowerCase().replace(/\s+/g, " ").trim()}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function blameAges(owner, name, branch, files, token) {
  // file -> [{start,end,date,author}]
  const result = {};
  if (!token) return result;
  const query = `query($owner:String!,$name:String!,$expr:String!,$path:String!){
    repository(owner:$owner,name:$name){ object(expression:$expr){ ... on Commit {
      blame(path:$path){ ranges{ startingLine endingLine commit{ committedDate author{ name } } } }
    }}}}`;
  await pool(files.slice(0, 25), 5, async (path) => {
    try {
      const r = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "todo-slayer", "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { owner, name, expr: branch, path } }),
      });
      const j = await r.json();
      const ranges = j?.data?.repository?.object?.blame?.ranges || [];
      result[path] = ranges.map((x) => ({
        start: x.startingLine,
        end: x.endingLine,
        date: x.commit?.committedDate,
        author: x.commit?.author?.name,
      }));
    } catch { /* blame is a bonus; ignore failures */ }
  });
  return result;
}

export async function scanRepo(input, token = process.env.GITHUB_TOKEN) {
  const repo = parseRepo(input);
  if (!repo) throw Object.assign(new Error("That doesn't look like a GitHub repo. Try owner/name."), { status: 400 });
  const { owner, name } = repo;

  const meta = await gh(`/repos/${owner}/${name}`, token);
  if (meta.status === 404) throw Object.assign(new Error("Repo not found (it must be public)."), { status: 404 });
  if (!meta.ok) throw Object.assign(new Error(`GitHub said ${meta.status}. Try again in a minute.`), { status: 502 });
  const { default_branch: branch } = await meta.json();

  // Pin to the exact head commit: raw.githubusercontent caches branch URLs for ~5 min, SHA URLs are exact.
  const headRes = await gh(`/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, token);
  if (!headRes.ok) throw Object.assign(new Error(`GitHub said ${headRes.status}. Try again in a minute.`), { status: 502 });
  const head = await headRes.json();
  const sha = head.sha;
  const commitMsg = (head.commit?.message || "").split("\n")[0].slice(0, 80);

  const treeRes = await gh(`/repos/${owner}/${name}/git/trees/${sha}?recursive=1`, token);
  const tree = await treeRes.json();
  const files = (tree.tree || [])
    .filter((t) => t.type === "blob" && t.size < 300_000 && CODE_EXT.test(t.path) && !SKIP_DIRS.test(t.path) && !SKIP_FILES.test(t.path))
    .map((t) => t.path);
  const totalFiles = files.length;
  files.splice(MAX_FILES);

  const found = [];
  await pool(files, 12, async (path) => {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (!r.ok) return;
      for (const f of detect(await r.text(), path)) {
        found.push({ id: monsterId(path, f.type, f.text), file: path, line: f.line, tag: f.type, text: f.text });
      }
    } catch { /* skip unreadable files */ }
  });

  // De-duplicate identical TODOs in the same file (same id) — keep first.
  const seen = new Set();
  const monsters = found
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
    ;
  const totalMonsters = monsters.length;
  monsters.splice(MAX_MONSTERS);

  const blame = await blameAges(owner, name, sha, [...new Set(monsters.map((m) => m.file))], token);
  const now = Date.now();
  for (const m of monsters) {
    const r = (blame[m.file] || []).find((x) => m.line >= x.start && m.line <= x.end);
    if (r?.date) {
      m.ageDays = Math.max(0, Math.floor((now - new Date(r.date).getTime()) / 86_400_000));
      m.bornOn = r.date.slice(0, 10);
      m.author = r.author || null;
    }
  }

  return { repo: `${owner}/${name}`, branch, sha, commitMsg, filesScanned: files.length, totalFiles, totalMonsters, monsters, scannedAt: new Date().toISOString() };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const data = await scanRepo(url.searchParams.get("repo"));
    data.monsters = await enrichMonsters(data.monsters);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Scan failed" });
  }
}
