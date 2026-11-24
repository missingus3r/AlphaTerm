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

// --- Traducciones de los commits ------------------------------------------------------------------
// Viven en src/i18n/changelog/<idioma>.json: { "<asunto en español, tal cual>": { "subject": "…",
// "body": "…" } }. La clave es el asunto y no el hash (el hash cambia si se reescribe el historial);
// `body` solo si el commit tiene cuerpo (sin las firmas que saca parseLog). Dos commits con el mismo
// asunto comparten traducción. Los "Versión X.Y.Z" que hace release.mjs se traducen solos.

/** Idiomas a los que se traduce el changelog (los commits se escriben en español). */
export const CHANGELOG_LANGS = ["en", "pt"];

const VERSION_SUBJECT = /^Versión (\d+\.\d+\.\d+)$/;
const VERSION_BODY = /^Sube de (\d+\.\d+\.\d+) a (\d+\.\d+\.\d+)\.$/;
const AUTO = {
  en: { subject: (v) => `Version ${v}`, body: (a, b) => `Bumps from ${a} to ${b}.` },
  pt: { subject: (v) => `Versão ${v}`, body: (a, b) => `Sobe de ${a} para ${b}.` },
};

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const entryOf = (dict, subject) => {
  const e = dict && Object.hasOwn(dict, subject) ? dict[subject] : undefined;
  return e && typeof e === "object" ? e : {};
};

/**
 * Un commit en otro idioma: { subject, body } con null en lo que falta traducir. `body` es "" si el
 * commit no tiene cuerpo (no hay nada que traducir, aunque la entrada traiga uno).
 */
export function translateCommit(c, lang, dict) {
  const auto = AUTO[lang];
  const v = auto && VERSION_SUBJECT.exec(c.subject);
  const vb = v && VERSION_BODY.exec(c.body);
  const e = entryOf(dict, c.subject);
  const subject = v ? auto.subject(v[1]) : text(e.subject);
  const body = !c.body ? "" : vb ? auto.body(vb[1], vb[2]) : text(e.body);
  return { subject, body };
}

/** Los commits con sus traducciones en `tr` ({ en: { subject, body }, pt: … }, solo lo que hay). */
export function withTranslations(commits, dicts) {
  return commits.map((c) => {
    const tr = {};
    for (const l of CHANGELOG_LANGS) {
      const { subject, body } = translateCommit(c, l, dicts?.[l]);
      const one = {};
      if (subject) one.subject = subject;
      if (body) one.body = body;
      if (Object.keys(one).length) tr[l] = one;
    }
    return Object.keys(tr).length ? { ...c, tr } : c;
  });
}

/** Commits con algo sin traducir: [{ commit, missing: { en: ["asunto", "cuerpo"], pt: ["cuerpo"] } }]. */
export function missingTranslations(commits, dicts) {
  const out = [];
  for (const c of commits) {
    const missing = {};
    for (const l of CHANGELOG_LANGS) {
      const { subject, body } = translateCommit(c, l, dicts?.[l]);
      const parts = [...(subject ? [] : ["asunto"]), ...(body === null ? ["cuerpo"] : [])];
      if (parts.length) missing[l] = parts;
    }
    if (Object.keys(missing).length) out.push({ commit: c, missing });
  }
  return out;
}

/** Entradas que ningún commit usa (pasa si se reescribe un asunto o el historial): [{ lang, subject }]. */
export function unusedTranslations(commits, dicts) {
  const used = new Set(commits.map((c) => c.subject));
  return CHANGELOG_LANGS.flatMap((l) => Object.keys(dicts?.[l] ?? {}).filter((s) => !used.has(s)).map((subject) => ({ lang: l, subject })));
}

/** Entradas mal formadas (tienen que ser { "subject": "…", "body"?: "…" }). Lista vacía = bien. */
export function dictProblems(dicts) {
  const out = [];
  for (const l of CHANGELOG_LANGS) {
    for (const [key, e] of Object.entries(dicts?.[l] ?? {})) {
      if (!e || typeof e !== "object" || Array.isArray(e)) out.push(`${l}: «${key}» tiene que ser { "subject": "…", "body": "…" }`);
      else if (!text(e.subject)) out.push(`${l}: «${key}» no tiene "subject"`);
      else if (e.body !== undefined && typeof e.body !== "string") out.push(`${l}: «${key}»: "body" tiene que ser texto`);
      else if (Object.keys(e).some((k) => k !== "subject" && k !== "body")) out.push(`${l}: «${key}»: solo van "subject" y "body"`);
    }
  }
  return out;
}
