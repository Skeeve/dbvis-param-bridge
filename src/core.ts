/**
 * Core conversion logic between the custom "@param" comment syntax and
 * dbVisualizer's parameterized SQL syntax:
 *
 *   ${variable||value||type||options}$
 *
 * This module has NO dependency on the "vscode" API on purpose, so it can be
 * unit-tested with plain Node.js (see src/test/core.test.ts) without needing
 * the VS Code Extension Host.
 *
 * Custom syntax written by the user, always inside a comment so the SQL/host
 * language compiler ignores it:
 *
 *   @param name="$1" prompt="teacher" type="String"
 *   @param name="$2" prompt="subject" type="string" default="mathematics" choices="mathematics,sports,language,physics" options="where"
 *
 *   SELECT * FROM classplan WHERE teacher=$1 AND subject=$2;
 *
 * - name     the placeholder actually used in the SQL/host code ($1, $2, :teacher, ...)
 * - prompt   dbVisualizer's variable name (the first field of ${...}$)
 * - type     dbVisualizer's type field
 * - default  dbVisualizer's value field (optional)
 * - choices  comma separated list -> rendered as "choices=[a,b,c]" inside the options field
 * - options  any additional dbVisualizer options (e.g. "where"), space separated
 */

export interface ParamDef {
  name: string;
  prompt: string;
  type: string;
  default: string;
  choices: string;
  options: string;
  /** The full source line the @param directive was found on. */
  raw: string;
  /** Character offset (in the text that was parsed) where the line starts. */
  start: number;
  /** Character offset (in the text that was parsed) where the line ends (exclusive, before the newline). */
  end: number;
}

export interface ConvertToDbVisResult {
  /** null when no @param definitions were found in the input. */
  result: string | null;
  paramCount: number;
}

export interface ConvertFromDbVisResult {
  /** null when no @param definitions were found in the input (nothing to map back to). */
  finalText: string | null;
  /** dbVisualizer variable names found in the clipboard text that had no matching @param prompt. */
  notFound: string[];
  /** [prompt, newDefaultValue] pairs whose default was updated because dbVisualizer held a different value. */
  changed: [string, string][];
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds every line containing an "@param ..." directive and extracts its
 * key="value" attributes. Supports straight ("...") and curly ("..."/“...”)
 * quotes, since some editors auto-correct quotes.
 */
export function parseParams(text: string): ParamDef[] {
  const results: ParamDef[] = [];
  const lineRegex = /^.*@param\b.*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = m.index + raw.length;

    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|“([^”]*)”|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRegex.exec(raw)) !== null) {
      const key = am[1];
      const value = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4];
      attrs[key] = value !== undefined ? value : '';
    }

    if (!attrs.name) {
      continue; // not a well-formed @param line, skip it
    }

    results.push({
      name: attrs.name,
      prompt: attrs.prompt !== undefined ? attrs.prompt : attrs.name,
      type: attrs.type !== undefined ? attrs.type : '',
      default: attrs.default !== undefined ? attrs.default : '',
      choices: attrs.choices !== undefined ? attrs.choices : '',
      options: attrs.options !== undefined ? attrs.options : '',
      raw,
      start,
      end,
    });
  }
  return results;
}

/** Combines choices + options into dbVisualizer's single options field. */
export function buildDbVisOptions(param: Pick<ParamDef, 'choices' | 'options'>): string {
  const parts: string[] = [];
  if (param.choices && param.choices.trim() !== '') {
    const list = param.choices
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',');
    parts.push(`choices=[${list}]`);
  }
  if (param.options && param.options.trim() !== '') {
    parts.push(param.options.trim());
  }
  return parts.join(' ');
}

/** Renders a single ${variable||value||type||options}$ placeholder. */
export function toDbVisPlaceholder(param: Pick<ParamDef, 'prompt' | 'default' | 'type' | 'choices' | 'options'>): string {
  const value = param.default || '';
  const type = param.type || '';
  const options = buildDbVisOptions(param);
  return `\${${param.prompt}||${value}||${type}||${options}}$`;
}

/** Removes the given @param lines (incl. trailing newline) from the text. */
export function removeParamLines(text: string, params: ParamDef[]): string {
  let result = text;
  const sorted = [...params].sort((a, b) => b.start - a.start);
  for (const p of sorted) {
    let end = p.end;
    if (result[end] === '\r') end++;
    if (result[end] === '\n') end++;
    result = result.slice(0, p.start) + result.slice(end);
  }
  return result;
}

/** Collapses a now-empty /* *\/ block comment (left over after stripping @param lines) so the clipboard result stays tidy. */
export function collapseEmptyCommentBlocks(text: string): string {
  return text.replace(/^[ \t]*\/\*[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*\*\/[ \t]*\r?\n?/gm, '');
}

export function trimLeadingBlankLines(text: string): string {
  return text.replace(/^(\s*\r?\n)+/, '');
}

/**
 * Converts custom @param + SQL text into dbVisualizer syntax.
 * Strips the @param directives from the output; only the rewritten SQL remains.
 */
export function convertToDbVisualizer(text: string): ConvertToDbVisResult {
  const params = parseParams(text);
  if (params.length === 0) {
    return { result: null, paramCount: 0 };
  }

  let body = removeParamLines(text, params);
  body = collapseEmptyCommentBlocks(body);
  body = trimLeadingBlankLines(body);

  const byName = new Map(params.map((p) => [p.name, p]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length > 0) {
    const pattern = names.map(escapeRegExp).join('|');
    // (?<!\w) / (?!\w) keep e.g. "$1" from matching inside "$10".
    const regex = new RegExp(`(?<!\\w)(?:${pattern})(?!\\w)`, 'g');
    body = body.replace(regex, (match) => {
      const p = byName.get(match);
      return p ? toDbVisPlaceholder(p) : match;
    });
  }

  return { result: body, paramCount: params.length };
}

/**
 * Splits text into the "header" (everything up to and including the last
 * @param line, plus a lone trailing block-comment closer line, e.g. a line
 * containing only the two characters star-slash) and
 * the "body" (the old SQL query that follows). The body is discarded by
 * convertFromDbVisualizer() - it gets replaced by the SQL coming back from
 * the clipboard.
 */
export function splitHeaderAndBody(text: string, params: ParamDef[]): { header: string; body: string } {
  if (params.length === 0) {
    return { header: '', body: text };
  }
  const lastEnd = params[params.length - 1].end;
  let idx = text.indexOf('\n', lastEnd);
  idx = idx === -1 ? text.length : idx + 1;

  const rest = text.slice(idx);
  const nextLineMatch = rest.match(/^([ \t]*\*\/[ \t]*)\r?\n?/);
  if (nextLineMatch) {
    idx += nextLineMatch[0].length;
  }
  return { header: text.slice(0, idx), body: text.slice(idx) };
}

/** Updates (or inserts) the default="..." attribute on a single @param source line. */
export function setDefaultAttr(raw: string, newVal: string): string {
  const escaped = String(newVal).replace(/"/g, '\\"');
  if (/default\s*=\s*"[^"]*"/.test(raw)) {
    return raw.replace(/default\s*=\s*"[^"]*"/, `default="${escaped}"`);
  }
  if (/default\s*=\s*“[^”]*”/.test(raw)) {
    return raw.replace(/default\s*=\s*“[^”]*”/, `default="${escaped}"`);
  }
  if (/type\s*=\s*"[^"]*"/.test(raw)) {
    return raw.replace(/(type\s*=\s*"[^"]*")/, `$1 default="${escaped}"`);
  }
  if (/name\s*=\s*"[^"]*"/.test(raw)) {
    return raw.replace(/(name\s*=\s*"[^"]*")/, `$1 default="${escaped}"`);
  }
  return `${raw} default="${escaped}"`;
}

/**
 * Converts dbVisualizer SQL (as copied from dbVisualizer, e.g. via the
 * clipboard) back into the driver placeholder syntax, using the @param
 * definitions found in `text` to map dbVisualizer's "prompt" names back to
 * the original "name" placeholders. Also syncs default="..." values back
 * into the @param header when dbVisualizer's value differs from what is
 * currently stored, so round-tripping doesn't lose edits made in dbVisualizer.
 */
export function convertFromDbVisualizer(text: string, clipboardText: string): ConvertFromDbVisResult {
  const params = parseParams(text);
  if (params.length === 0) {
    return { finalText: null, notFound: [], changed: [] };
  }

  const { header } = splitHeaderAndBody(text, params);
  const byPrompt = new Map(params.map((p) => [p.prompt, p]));

  const dbVisRegex = /\$\{([^|{}]*)\|\|([^|{}]*)\|\|([^|{}]*)\|\|([^{}]*)\}\$/g;
  const notFound: string[] = [];
  const changedDefaults = new Map<string, string>();

  const newBody = clipboardText.replace(dbVisRegex, (whole, promptRaw: string, valueRaw: string) => {
    const prompt = promptRaw.trim();
    const value = valueRaw.trim();
    const p = byPrompt.get(prompt);
    if (!p) {
      notFound.push(prompt);
      return whole;
    }
    if (value !== (p.default || '').trim()) {
      changedDefaults.set(prompt, value);
    }
    return p.name;
  });

  let updatedHeader = header;
  if (changedDefaults.size > 0) {
    const sorted = [...params].sort((a, b) => b.start - a.start);
    for (const p of sorted) {
      if (!changedDefaults.has(p.prompt)) continue;
      const newVal = changedDefaults.get(p.prompt)!;
      const updatedLine = setDefaultAttr(p.raw, newVal);
      updatedHeader = updatedHeader.slice(0, p.start) + updatedLine + updatedHeader.slice(p.end);
    }
  }

  let finalText = updatedHeader;
  if (finalText.length > 0 && !/\r?\n$/.test(finalText)) {
    finalText += '\n';
  }
  finalText += newBody;

  return { finalText, notFound, changed: [...changedDefaults.entries()] };
}
