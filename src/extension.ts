import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('vcdProtocol.openViewer', async () => {
    const panel = vscode.window.createWebviewPanel(
      'vcdViewer',
      'VCD Viewer',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
      }
    );

    const indexPath = path.join(context.extensionPath, 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) {
      vscode.window.showErrorMessage('Build the web app first: run `npm run build`');
      return;
    }

    let html = fs.readFileSync(indexPath, 'utf8');

    // Rewrite asset URLs (href/src) to use webview URIs
    html = html.replace(/(href|src)=("|')\/?([^"'>]+)("|')/g, (m, attr, q1, p1, q2) => {
      try {
        const resource = vscode.Uri.joinPath(context.extensionUri, 'dist', p1);
        const webviewUri = panel.webview.asWebviewUri(resource);
        return `${attr}=${q1}${webviewUri}${q2}`;
      } catch (e) {
        return m;
      }
    });

    panel.webview.html = html;
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
