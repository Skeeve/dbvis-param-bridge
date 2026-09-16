import * as vscode from 'vscode';
import { convertFromDbVisualizer, convertToDbVisualizer } from './core';

function getSelectionOrWholeDocument(editor: vscode.TextEditor): { text: string; range: vscode.Range; usedWholeDocument: boolean } {
  const sel = editor.selection;
  if (!sel.isEmpty) {
    return { text: editor.document.getText(sel), range: sel, usedWholeDocument: false };
  }
  const fullText = editor.document.getText();
  const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(fullText.length));
  return { text: fullText, range: fullRange, usedWholeDocument: true };
}

async function copyAsDbVisualizer(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('dbVis Param Bridge: No active editor.');
    return;
  }

  const { text, usedWholeDocument } = getSelectionOrWholeDocument(editor);
  const { result, paramCount } = convertToDbVisualizer(text);

  if (result === null) {
    void vscode.window.showWarningMessage(
      'dbVis Param Bridge: No "@param ..." definitions found. Please select the parameter block (and the query).'
    );
    return;
  }

  await vscode.env.clipboard.writeText(result);

  const scope = usedWholeDocument ? 'in the document' : 'in the selection';
  void vscode.window.showInformationMessage(
    `dbVis Param Bridge: Converted ${paramCount} parameter(s) (${scope}) to dbVisualizer syntax and copied to the clipboard.`
  );
}

async function pasteFromDbVisualizer(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('dbVis Param Bridge: No active editor.');
    return;
  }

  const { text, range, usedWholeDocument } = getSelectionOrWholeDocument(editor);

  const clipboardText = await vscode.env.clipboard.readText();
  if (!clipboardText || clipboardText.trim() === '') {
    void vscode.window.showWarningMessage('dbVis Param Bridge: The clipboard is empty.');
    return;
  }

  const { finalText, notFound, changed } = convertFromDbVisualizer(text, clipboardText);

  if (finalText === null) {
    void vscode.window.showWarningMessage(
      'dbVis Param Bridge: No "@param ..." definitions found in the selected range. Please also select the original parameter block so dbVisualizer variable names can be mapped back to $1, $2, ...'
    );
    return;
  }

  const applied = await editor.edit((editBuilder) => {
    editBuilder.replace(range, finalText);
  });

  if (!applied) {
    void vscode.window.showErrorMessage('dbVis Param Bridge: Could not write the change to the editor.');
    return;
  }

  const scope = usedWholeDocument ? 'document' : 'selection';
  const parts: string[] = [`dbVis Param Bridge: Wrote the SQL from the clipboard back into the ${scope}.`];
  if (changed.length > 0) {
    const changedList = changed.map(([prompt, value]) => `${prompt}="${value}"`).join(', ');
    parts.push(`Updated default value(s): ${changedList}.`);
  }
  if (notFound.length > 0) {
    parts.push(`Warning: no matching @param definition found for: ${[...new Set(notFound)].join(', ')}.`);
  }
  void vscode.window.showInformationMessage(parts.join(' '));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('dbvisParamBridge.copyAsDbVisualizer', copyAsDbVisualizer),
    vscode.commands.registerCommand('dbvisParamBridge.pasteFromDbVisualizer', pasteFromDbVisualizer)
  );
}

export function deactivate(): void {
  // nothing to clean up
}
