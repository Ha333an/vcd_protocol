import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // Keep command to open viewer programmatically
  const disposable = vscode.commands.registerCommand('vcdProtocol.openViewer', async (uri?: vscode.Uri) => {
    if (uri) {
      vscode.commands.executeCommand('vscode.openWith', uri, VcdCustomEditorProvider.viewType);
    } else {
      vscode.window.showInformationMessage('Open a .vcd file to view it.');
    }
  });

  // Register custom editor provider so .vcd opens with the viewer by default
  class VcdCustomEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'vcdProtocol.viewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
      };

      const indexPath = path.join(this.context.extensionPath, 'dist', 'index.html');
      if (!fs.existsSync(indexPath)) {
        vscode.window.showErrorMessage('Build the web app first: run `npm run build`');
        return;
      }

      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(/(href|src)=("|')\/?([^"'>]+)("|')/g, (m, attr, q1, p1, q2) => {
        try {
          const resource = vscode.Uri.joinPath(this.context.extensionUri, 'dist', p1);
          const webviewUri = webviewPanel.webview.asWebviewUri(resource);
          return `${attr}=${q1}${webviewUri}${q2}`;
        } catch (e) {
          return m;
        }
      });

      webviewPanel.webview.html = html;

      // Listen for a ready handshake from the webview before posting large content.
      const readyListener = webviewPanel.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === 'ready') {
          webviewPanel.webview.postMessage({ type: 'openVCD', content: document.getText() });
        }
      });

      // Fallback: if the webview missed the handshake, post after a short delay.
      const fallbackTimer = setTimeout(() => {
        try {
          webviewPanel.webview.postMessage({ type: 'openVCD', content: document.getText() });
        } catch (e) {}
      }, 250);

      // Update webview when the document changes
      const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          webviewPanel.webview.postMessage({ type: 'openVCD', content: document.getText() });
        }
      });

      webviewPanel.onDidDispose(() => {
        changeSub.dispose();
        readyListener.dispose();
        clearTimeout(fallbackTimer);
      });
    }
  }

  context.subscriptions.push(disposable, vscode.window.registerCustomEditorProvider(VcdCustomEditorProvider.viewType, new VcdCustomEditorProvider(context), { supportsMultipleEditorsPerDocument: false }));
}

export function deactivate() {}
