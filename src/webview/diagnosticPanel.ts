import * as vscode from 'vscode';

export class DiagnosticPanel {
  public static currentPanel: DiagnosticPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, conflictFiles: string[]) {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (DiagnosticPanel.currentPanel) {
      DiagnosticPanel.currentPanel._update(conflictFiles);
      DiagnosticPanel.currentPanel._panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'gitConflictDiagnostics',
        'Git Conflict Anticipator',
        column,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        }
      );

      DiagnosticPanel.currentPanel = new DiagnosticPanel(panel, extensionUri, conflictFiles);
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, conflictFiles: string[]) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._update(conflictFiles);
  }

  private _update(conflictFiles: string[]) {
    this._panel.webview.html = this._getHtmlForWebview(conflictFiles);
  }

  private _getHtmlForWebview(conflicts: string[]) {
    const listItems = conflicts.map(f => `
      <tr>
        <td>${f}</td>
        <td><button onclick="vscode.postMessage({ command: 'open', file: '${f}' })">Ouvrir</button></td>
      </tr>
    `).join('');

    return /* html */ `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Conflits Git détectés</title>
        <style>
          body { font-family: sans-serif; padding: 1em; }
          table { border-collapse: collapse; width: 100%; }
          th, td { padding: 0.5em; border: 1px solid #ddd; }
          th { background-color: #f4f4f4; }
        </style>
      </head>
      <body>
        <h2>Fichiers en conflit</h2>
        <table>
          <tr><th>Fichier</th><th>Action</th></tr>
          ${listItems}
        </table>

        <script>
          const vscode = acquireVsCodeApi();
        </script>
      </body>
      </html>
    `;
  }

  public dispose() {
    DiagnosticPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
  }
}
