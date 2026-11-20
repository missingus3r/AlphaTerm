// Lógica pura del changelog y de las versiones (sin git ni archivos: se testea en changelog.test.mjs).

/** Sube una versión semver: "patch" 0.2.0 → 0.2.1, "minor" → 0.3.0, "major" → 1.0.0. */
export function bumpVersion(version, kind = "patch") {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`Versión inválida: ${version}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (kind === "major") [maj, min, pat] = [maj + 1, 0, 0];
  else if (kind === "minor") [min, pat] = [min + 1, 0];
  else if (kind === "patch") pat += 1;
  else throw new Error(`Tipo de versión desconocido: ${kind} (patch, minor o major)`);
  return `${maj}.${min}.${pat}`;
}

const US = "\x1f";
const RS = "\x1e";
/** Formato de `git log` que entiende parseLog. */
export const LOG_FORMAT = `%H${US}%h${US}%aI${US}%s${US}%b${RS}`;

/** Líneas de firma que no aportan al changelog. */
const NOISE = /^(Co-Authored-By|Claude-Session|Signed-off-by):/i;

export function parseLog(raw) {
  return raw
    .split(RS)
    .map((r) => r.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((r) => {
      const [hash, short, date, subject, body = ""] = r.split(US);
      const clean = body
        .split(/\r?\n/)
        .filter((l) => !NOISE.test(l.trim()))
        .join("\n")
        .trim();
      return { hash, short, date, subject: subject.trim(), body: clean };
    })
    .filter((c) => c.hash && c.subject);
}

/**
 * Tags de versión: líneas "nombre<US>objeto<US>objeto apuntado" (los tags anotados apuntan a un
 * objeto tag; el commit real es el tercer campo). Solo vX.Y.Z.
 */
export function parseTags(raw) {
  const out = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const [name, obj, deref] = line.split(US);
    const m = /^v(\d+\.\d+\.\d+)$/.exec((name ?? "").trim());
    if (!m) continue;
    out.set((deref || obj).trim(), m[1]);
  }
  return out;
}

/**
 * Agrupa los commits (del más nuevo al más viejo) por versión: cada tag abre su versión y los
 * commits más viejos que él, hasta el tag anterior, son de esa versión. Lo que está arriba del tag
 * más nuevo es `next` (la versión que se está compilando) o "sin publicar".
 */
export function groupByVersion(commits, tags, next, now = new Date().toISOString()) {
  const versions = [];
  let current = { version: next ?? null, date: next ? now : null, released: !!next, commits: [] };
  for (const c of commits) {
    const tagged = tags.get(c.hash);
    if (tagged) {
      if (current.commits.length) versions.push(current);
      current = { version: tagged, date: c.date, released: true, commits: [] };
    }
    current.commits.push(c);
  }
  if (current.commits.length) versions.push(current);
  return versions;
}
