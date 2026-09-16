/**
 * Plain Node.js sanity checks for src/core.ts (no VS Code Extension Host
 * required). Run after compiling with `npm run compile`:
 *
 *   npm run test:core
 */
import * as assert from 'assert';
import { convertFromDbVisualizer, convertToDbVisualizer } from '../core';

const source = `/*
@param name="$1" prompt="teacher" type="String"
@param name="$2" prompt="subject" type="string" default="mathematics" choices="mathematics,sports,language,physics" options="where"
*/
SELECT * FROM classplan
WHERE teacher=$1
AND subject=$2;
`;

// --- Forward: custom syntax -> dbVisualizer syntax ---------------------
const fwd = convertToDbVisualizer(source);
assert.ok(fwd.result, 'forward conversion returned null');
assert.strictEqual(fwd.paramCount, 2);
assert.ok(fwd.result!.includes('${teacher||||String||}$'), 'teacher placeholder mismatch');
assert.ok(
  fwd.result!.includes('${subject||mathematics||string||choices=[mathematics,sports,language,physics] where}$'),
  'subject placeholder mismatch'
);
console.log('OK: convertToDbVisualizer matches the expected dbVisualizer syntax.');

// --- Reverse: dbVisualizer syntax (clipboard) -> custom syntax ---------
const clipboard = `SELECT * FROM classplan
WHERE teacher=\${teacher||Smith||String||}$
AND subject=\${subject||physics||string||choices=[mathematics,sports,language,physics] where}$;
`;

const rev = convertFromDbVisualizer(source, clipboard);
assert.ok(rev.finalText, 'reverse conversion returned null');
assert.ok(rev.finalText!.includes('WHERE teacher=$1'), 'teacher placeholder not restored');
assert.ok(rev.finalText!.includes('AND subject=$2'), 'subject placeholder not restored');
assert.ok(rev.finalText!.includes('default="Smith"'), 'teacher default not synced back');
assert.ok(rev.finalText!.includes('default="physics"'), 'subject default not updated');
assert.strictEqual(rev.notFound.length, 0, 'unexpected unmatched placeholders');
console.log('OK: convertFromDbVisualizer restores driver placeholders and syncs defaults.');

// --- Edge case: $1 must not collide with $10 / $100 ---------------------
const source2 = `-- @param name="$1" prompt="a" type="String"
-- @param name="$10" prompt="b" type="String"
SELECT $1, $10, $100;`;
const fwd2 = convertToDbVisualizer(source2);
assert.ok(fwd2.result!.includes('${a||||String||}$'), '$1 not replaced correctly');
assert.ok(fwd2.result!.includes('${b||||String||}$'), '$10 not replaced correctly');
assert.ok(fwd2.result!.includes('$100'), '$100 should remain untouched (no matching @param)');
console.log('OK: $1 / $10 / $100 do not collide.');

console.log('\nALL CORE TESTS PASSED');
