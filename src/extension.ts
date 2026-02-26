import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const openViewer = async (uri?: vscode.Uri) => {
    const panel = vscode.window.createWebviewPanel(
      'vcdViewer',
      uri ? `VCD Viewer — ${path.basename(uri.fsPath)}` : 'VCD Viewer',
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

    // If a URI was provided, read file and post message to webview once ready
    if (uri) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString('utf8');
        // Delay slightly to allow the webview to initialize
        setTimeout(() => panel.webview.postMessage({ type: 'openVCD', content }), 300);
      } catch (e) {
        console.error('Failed to load VCD:', e);
      }
    }
  };

  const disposable = vscode.commands.registerCommand('vcdProtocol.openViewer', async (uri?: vscode.Uri) => openViewer(uri));

  // When a text document is opened and has .vcd extension, open the viewer
  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri && doc.uri.fsPath && doc.uri.fsPath.toLowerCase().endsWith('.vcd')) {
      vscode.commands.executeCommand('vcdProtocol.openViewer', doc.uri);
    }
  });

  context.subscriptions.push(disposable, onOpen);
}

export function deactivate() {}
