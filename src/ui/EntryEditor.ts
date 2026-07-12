import * as vscode from 'vscode';

export async function promptMasterPassword(
  title: string,
  confirm = false
): Promise<string | undefined> {
  const password = await vscode.window.showInputBox({
    title,
    prompt: 'Enter master password',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length < 8 ? 'Master password must be at least 8 characters' : undefined),
  });
  if (password === undefined) {
    return undefined;
  }
  if (!confirm) {
    return password;
  }
  const again = await vscode.window.showInputBox({
    title,
    prompt: 'Confirm master password',
    password: true,
    ignoreFocusOut: true,
  });
  if (again === undefined) {
    return undefined;
  }
  if (again !== password) {
    void vscode.window.showErrorMessage('Passwords do not match');
    return undefined;
  }
  return password;
}
