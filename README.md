# dbVisualizer Parameter Bridge

A VS Code extension that converts between a custom, readable `@param` comment
syntax and the [dbVisualizer parameter syntax](https://www.dbvis.com/docs/ug/working-with-sql/parameterized-sql-variables-and-parameter-markers/)
(`${variable||value||type||options}$`) — in both directions.

This lets you write your actual driver's placeholder syntax in your source
code (`$1`, `$2`, `:name`, ...) while still being able to work comfortably
with dbVisualizer variables (prompt, default value, type, choices, options)
without translating the syntax by hand.

> Built by [Claude](https://claude.com) (Anthropic's AI assistant), based on
> a syntax proposal by the extension's author.

## Custom syntax

Written directly above the query, inside a comment (so the compiler/driver
ignores it):

```sql
/*
@param name="$1" prompt="teacher" type="String"
@param name="$2" prompt="subject" type="string" default="mathematics" choices="mathematics,sports,language,physics" options="where"
*/
SELECT * FROM classplan
WHERE teacher=$1
AND subject=$2;
```

| Attribute  | Meaning                                                                      |
|------------|-------------------------------------------------------------------------------|
| `name`     | The placeholder actually used in your SQL/code (`$1`, `:teacher`, ...)       |
| `prompt`   | dbVisualizer's variable name (1st field in `${...}$`)                        |
| `type`     | dbVisualizer's type (3rd field)                                              |
| `default`  | Default value (2nd field), optional                                          |
| `choices`  | Comma-separated list, rendered as `choices=[a,b,c]` inside the options field |
| `options`  | Additional dbVisualizer options (e.g. `where`), appended after `choices=[...]` |

An `@param ...` line can live in any comment style (`/* ... */`, `--`, `//`,
etc.) — the extension recognizes the line by the `@param` keyword, not by the
comment marker.

## Commands

Available via the Command Palette (`Cmd/Ctrl+Shift+P`) or the editor context
menu (right-click):

- **dbVis Param Bridge: Copy as dbVisualizer Syntax (Clipboard)**
  Select the `@param` block **and** the query. This command converts both
  into plain dbVisualizer SQL (the `@param` lines are removed, each
  placeholder is replaced with `${prompt||default||type||choices/options}$`)
  and copies the result **only to the clipboard** (the editor content is
  left untouched). Paste it into dbVisualizer and you're set.

- **dbVis Param Bridge: Write Back from Clipboard (dbVisualizer)**
  Copy the SQL (possibly edited in dbVisualizer) to your clipboard. In VS
  Code, select the original `@param` block (so the extension knows which
  `prompt` name maps to which `name`) and run this command. It replaces the
  selection with:
  - the `@param` block (default values are updated automatically if you
    changed them in dbVisualizer),
  - followed by the SQL using the original placeholders (`$1`, `$2`, ...)
    instead of the dbVisualizer syntax.

If nothing is selected, both commands operate on the whole document.

## Example

Input (selected):

```sql
/*
@param name="$1" prompt="teacher" type="String"
@param name="$2" prompt="subject" type="string" default="mathematics" choices="mathematics,sports,language,physics" options="where"
*/
SELECT * FROM classplan
WHERE teacher=$1
AND subject=$2;
```

→ *"Copy as dbVisualizer Syntax"* puts this on the clipboard:

```sql
SELECT * FROM classplan
WHERE teacher=${teacher||||String||}$
AND subject=${subject||mathematics||string||choices=[mathematics,sports,language,physics] where}$;
```

After working in dbVisualizer (clipboard now contains, say, changed default
values) → *"Write Back from Clipboard"* (with the `@param` block still
selected) produces again:

```sql
/*
@param name="$1" prompt="teacher" type="String" default="Smith"
@param name="$2" prompt="subject" type="string" default="physics" choices="mathematics,sports,language,physics" options="where"
*/
SELECT * FROM classplan
WHERE teacher=$1
AND subject=$2;
```

## Known limitations

- Purely positional, non-unique placeholders (e.g. repeated `?`) cannot be
  reliably mapped back to individual `@param` definitions — use numbered or
  named placeholders instead (`$1`, `$2`, `:name`, ...).
- Mapping on write-back is done via `prompt`, so `prompt` names must be
  unique within a selected block.
- This uses robust, regex-based substitution with word-boundary protection
  (e.g. `$1` won't accidentally match inside `$10`) rather than a full SQL
  parser.
- Requires the original `@param` block to be selected (or present in the
  document) when writing back — the extension does not invent or guess the
  block, since the `prompt` → `name` mapping only exists there.

## Development / Installation

```bash
npm install
npm run compile
npm run test:core   # pure logic tests, no VS Code Extension Host required
```

To try it locally: open the folder in VS Code and press `F5` (starts an
Extension Development Host). To produce an installable file:

```bash
npm install -g @vscode/vsce
vsce package
```

This creates a `.vsix` file that can be installed via *Extensions → "..." →
Install from VSIX...*.
