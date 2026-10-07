// Debt type decides the monster. AI (optional) only adds a funny name + taunt.
// Without OPENAI_API_KEY the game still works with deterministic names.

export const SPECIES = {
  TODO:        { species: "TODO Goblin",       icon: "👺", base: 2 },
  FIXME:       { species: "FIXME Troll",       icon: "👹", base: 3 },
  HACK:        { species: "Hack Beast",        icon: "💀", base: 3 },
  PLACEHOLDER: { species: "Placeholder Zombie", icon: "🧟", base: 2 },
  STUB:        { species: "Stub Dragon",       icon: "🐉", base: 4 },
  SILENT:      { species: "Silent Exception",  icon: "👻", base: 3 },
};

const TAUNTS = {
  TODO: ["You said you'd do it later.", "Later never came.", "Still here. Still later."],
  FIXME: ["You knew I was broken.", "You shipped me anyway.", "Broken. Proudly."],
  HACK: ["Temporary. For years.", "Duct tape holds this kingdom.", "Nobody remembers why I work."],
  PLACEHOLDER: ["This isn't even real data.", "I was supposed to be replaced.", "In a real app, I wouldn't exist."],
  STUB: ["You summoned me unfinished.", "Call me. I dare you.", "I compile. That's all."],
  SILENT: ["You caught me. Then ignored me.", "Something broke. I told no one.", "Shhh. The errors are sleeping."],
};

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function fallbackMonster(m) {
  const kind = SPECIES[m.tag] || SPECIES.TODO;
  const taunts = TAUNTS[m.tag] || TAUNTS.TODO;
  return { ...m, name: kind.species, species: kind.species, icon: kind.icon, difficulty: kind.base, taunt: taunts[hash(m.id) % taunts.length] };
}

// HP: debt type sets the base; age makes it tougher. The oldest monster is the boss and its HP = its age in days.
export function withHp(monsters) {
  const out = monsters.map((m) => ({ ...m, hp: m.difficulty * 100 + Math.min(300, Math.floor((m.ageDays ?? 0) / 2)) }));
  const aged = out.filter((m) => m.ageDays != null);
  if (aged.length) {
    const boss = aged.reduce((a, b) => (b.ageDays > a.ageDays ? b : a));
    boss.boss = true;
    boss.hp = Math.max(boss.hp, boss.ageDays);
    const who = (boss.author || "").split(/\s+/)[0];
    boss.taunt = `You left me here ${boss.ageDays} days ago${who ? `, ${who}` : ""}. I'm still waiting.`;
  }
  return out;
}

async function aiFlavor(monsters, key) {
  const items = monsters.map((m) => ({ id: m.id, type: m.tag, text: m.text }));
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Each item is unfinished code debt (TODO, FIXME, HACK, PLACEHOLDER, STUB, SILENT exception) that became a monster in a game. " +
            "Give each a short title (2-4 words, funny, specific to its text) and a taunt (one witty line the monster says to the developer, under 14 words, never insulting people). " +
            'Return {"monsters":[{"id":..., "title":..., "taunt":...}]} with ids unchanged.',
        },
        { role: "user", content: JSON.stringify(items) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const j = await res.json();
  return new Map((JSON.parse(j.choices[0].message.content).monsters || []).map((x) => [x.id, x]));
}

export async function enrichMonsters(monsters) {
  let out = monsters.map(fallbackMonster);
  const key = process.env.OPENAI_API_KEY;
  if (key && out.length) {
    try {
      const flavor = await aiFlavor(out, key);
      out = out.map((m) => {
        const f = flavor.get(m.id);
        return f ? { ...m, title: String(f.title || "").slice(0, 40), taunt: String(f.taunt || m.taunt).slice(0, 120) } : m;
      });
    } catch { /* flavor is optional */ }
  }
  return withHp(out);
}
