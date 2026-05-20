import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

function convertWlfToVcd(wlfPath: string): Promise<string> {
  const tempPrefix = path.join(os.tmpdir(), 'vcd-protocol-');

  return new Promise((resolve, reject) => {
    fs.promises
      .mkdtemp(tempPrefix)
      .then(async (tempDir) => {
        const outPath = path.join(tempDir, `${path.basename(wlfPath, path.extname(wlfPath))}.vcd`);

        execFile('wlf2vcd', [wlfPath, outPath], async (error) => {
          try {
            if (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(new Error('`wlf2vcd` command not found. Install it and ensure it is available in PATH.'));
                return;
              }
              reject(new Error(`wlf2vcd failed for ${path.basename(wlfPath)}.`));
              return;
            }

            const vcdContent = await fs.promises.readFile(outPath, 'utf8');
            resolve(vcdContent);
          } catch {
            reject(new Error('Failed to read converted VCD output from wlf2vcd.'));
          } finally {
            try {
              await fs.promises.rm(tempDir, { recursive: true, force: true });
            } catch {}
          }
        });
      })
      .catch(() => reject(new Error('Failed to create a temporary directory for WLF conversion.')));
  });
}

export function activate(context: vscode.ExtensionContext) {
  // Keep command to open viewer programmatically
  const disposable = vscode.commands.registerCommand('vcdProtocol.openViewer', async (uri?: vscode.Uri) => {
    if (uri) {
      vscode.commands.executeCommand('vscode.openWith', uri, VcdCustomEditorProvider.viewType);
    } else {
      vscode.window.showInformationMessage('Open a .vcd or .wlf file to view it.');
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

      const extension = path.extname(document.uri.fsPath).toLowerCase();
      let contentPromise: Promise<string> | undefined;
      const getWaveformContent = (): Promise<string> => {
        if (contentPromise) {
          return contentPromise;
        }

        contentPromise = extension === '.wlf'
          ? convertWlfToVcd(document.uri.fsPath)
          : Promise.resolve(document.getText());

        return contentPromise;
      };

      const postWaveformContent = async () => {
        try {
          const content = await getWaveformContent();
          webviewPanel.webview.postMessage({ type: 'openVCD', content });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to open waveform file.';
          vscode.window.showErrorMessage(message);
        }
      };

      // Listen for a ready handshake from the webview before posting large content.
      const readyListener = webviewPanel.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === 'ready') {
          void postWaveformContent();
        }
      });

      // Fallback: if the webview missed the handshake, post after a short delay.
      const fallbackTimer = setTimeout(() => {
        try {
          void postWaveformContent();
        } catch (e) {}
      }, 250);

      // Update webview when the document changes
      const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          if (extension === '.wlf') {
            return;
          }

          contentPromise = Promise.resolve(document.getText());
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
