import * as vscode from 'vscode';
import { ConflictFilesProvider } from './treeView';
import { clearDecorations, watchWorkspace } from './watcher';
import { getConflictedFiles } from './conflictDetector';
import { translate } from './language';
// import { DiagnosticPanel } from './webview/diagnosticPanel';
import { hasPotentialConflicts } from './conflictScanner/detectConflicts';
import { checkConflictForDocument } from './conflictScanner/checkConflictForDocument';
import { checkGitConflicts } from './conflictScanner/checkGitConflict';

let conflictFilesProvider: ConflictFilesProvider;
let treeView: vscode.TreeView<vscode.TreeItem>;
let statusBarItem: vscode.StatusBarItem;

let isExtensionEnabled: boolean = true;

const systemLanguage = vscode.env.language;

 

/**
 * Affiche une alerte si des conflits Git sont détectés.
 */
async function notifyIfConflicts(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}

	for (const folder of workspaceFolders) {
		const folderPath = folder.uri.fsPath;
		const hasConflicts = await checkGitConflicts(folderPath);
		if (hasConflicts) {
			vscode.window.showWarningMessage(`⚠️ Conflits Git détectés dans "${folder.name}"`);
		} else {
			console.log(`Pas de conflit détecté dans ${folder.name}`);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
  console.log(translate('Git Conflict Anticipator is now active!'));

  // Initialize configuration
  const config = vscode.workspace.getConfiguration('gitConflictAnticipator');
  let targetBranch = config.get<string>('targetBranch', 'main');
  isExtensionEnabled = config.get<boolean>('enabled', true);

  	// Commande manuelle pour vérifier les conflits
	const disposable = vscode.commands.registerCommand('extension.checkConflicts', async () => {
		await notifyIfConflicts(context);
	});
	context.subscriptions.push(disposable);

	// Watcher pour détecter les changements dans l'index Git (où les conflits apparaissent)
	const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index');

	gitWatcher.onDidChange(async () => {
		console.log('git/index modified, checking conflicts...');
		await notifyIfConflicts(context);
	});

  // Create TreeView provider
  conflictFilesProvider = new ConflictFilesProvider(targetBranch);

  // Create Diagnostic Panel
  /*DiagnosticPanel.createOrShow(context.extensionUri, []);*/
  
  // Register TreeView
  treeView = vscode.window.createTreeView('gitConflictFiles', {
    treeDataProvider: conflictFilesProvider,
    showCollapseAll: true
  });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'Git Conflict Anticipator status';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  console.log(translate('TreeView created successfully'));

  // Register commands
  const commands = {
    refresh: vscode.commands.registerCommand('gitConflictAnticipator.refreshTree', async () => {
      if (!isExtensionEnabled) {
        return;
      } 
      console.log(translate('Manual refresh triggered'));
      await refreshAllConflicts();
      conflictFilesProvider.refresh();
    }),

    setBranch: vscode.commands.registerCommand('gitConflictAnticipator.setBranch', async () => {
      if (!isExtensionEnabled) {
        return;
      }

      let message = ''; 
      if (systemLanguage.startsWith('fr')) {
        message = translate('Entrez le nom de la branche cible pour la détection des conflits');
      } else {
        message = translate('Enter target branch name for conflict detection');
      }
      const newBranch = await vscode.window.showInputBox({
        prompt: message,
        value: targetBranch,
        placeHolder: 'ex: main, develop, master'
      });

      if (newBranch && newBranch !== targetBranch) {
        targetBranch = newBranch;
        conflictFilesProvider.setTargetBranch(targetBranch);
        await config.update('targetBranch', targetBranch, vscode.ConfigurationTarget.Workspace);
        await refreshAllConflicts();
        let message = '';
        if (systemLanguage.startsWith('fr')) {
          message = translate(`Branche cible mise à jour: ${targetBranch}`);
        } else {
          message = translate(`Target branch updated: ${targetBranch}`);
        }
        vscode.window.showInformationMessage(message);
      }
    }),

    openFile: vscode.commands.registerCommand('gitConflictAnticipator.openFile', async (uri: vscode.Uri) => {
      if (uri) {
        await vscode.window.showTextDocument(uri);
      } 
    }),

    enable: vscode.commands.registerCommand('gitConflictAnticipator.enable', async () => {
      isExtensionEnabled = true;
      await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
      vscode.commands.executeCommand('setContext', 'gitConflictAnticipator.enabled', true);
      await refreshAllConflicts();
      vscode.window.showInformationMessage(translate('Git Conflict Anticipator enabled'));
    }),

    disable: vscode.commands.registerCommand('gitConflictAnticipator.disable', async () => {
      isExtensionEnabled = false;
      await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
      vscode.commands.executeCommand('setContext', 'gitConflictAnticipator.enabled', false);
      
      vscode.window.visibleTextEditors.forEach(editor => clearDecorations(editor.document));
      conflictFilesProvider.updateConflictedFiles([]);
      vscode.window.showInformationMessage(translate('Git Conflict Anticipator disabled'));
    })
  };

  // Configuration change listener
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (!e.affectsConfiguration('gitConflictAnticipator')) {
      return;
    }

    const newConfig = vscode.workspace.getConfiguration('gitConflictAnticipator');
    const newTargetBranch = newConfig.get<string>('targetBranch', 'main');
    const newEnabled = newConfig.get<boolean>('enabled', true);

    if (newTargetBranch !== targetBranch) {
      targetBranch = newTargetBranch;
      conflictFilesProvider.setTargetBranch(targetBranch);
      if (isExtensionEnabled) {
        await refreshAllConflicts();
      }
    }

    if (newEnabled !== isExtensionEnabled) {
      isExtensionEnabled = newEnabled;
      vscode.commands.executeCommand('setContext', 'gitConflictAnticipator.enabled', isExtensionEnabled);
      
      if (isExtensionEnabled) {
        await refreshAllConflicts();
      } else {
        vscode.window.visibleTextEditors.forEach(editor => clearDecorations(editor.document));
        conflictFilesProvider.updateConflictedFiles([]);
      }
    }
  });

  // Document change listeners
  const docChangeListener = vscode.workspace.onDidChangeTextDocument(async (e) => {
    if (!isExtensionEnabled) {
      return;
    }
    if (config.get<boolean>('autoRefresh', true)) {
      await handleDocumentChange(e.document);
    }
  });

  const docOpenListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (!isExtensionEnabled) {
      return;
    }
    await handleDocumentChange(document);
  });

  //Document saved
  const docSaveListener = vscode.workspace.onDidSaveTextDocument(async () => {
    const hasConflicts = await hasPotentialConflicts(targetBranch, 'origin/' + targetBranch);
    if (hasConflicts) {
      vscode.window.showWarningMessage('⚠️ Potential conflicts detected between your local branch and the remote branch.');
    }
  });


  // Setup workspace watchers
  if (vscode.workspace.workspaceFolders) {
    vscode.workspace.workspaceFolders.forEach(folder => {
      watchWorkspace(folder.uri.fsPath, targetBranch, conflictFilesProvider, context);
    });
  }

  // Initial scan
  if (isExtensionEnabled) {
    refreshAllConflicts();
  }

  // Register disposables
  context.subscriptions.push(
    treeView,
    ...Object.values(commands),
    configChangeListener,
    docChangeListener,
    docOpenListener,
    gitWatcher,
    docSaveListener
  );

  console.log(translate('Git Conflict Anticipator setup complete'));
}

async function handleDocumentChange(document: vscode.TextDocument) {
  if (!isExtensionEnabled || document.uri.scheme !== 'file') {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return;
  }

  const targetBranch = conflictFilesProvider.getTargetBranch();
  await checkConflictForDocument(document, workspaceFolder.uri.fsPath, targetBranch);
  
  const conflictedFiles = getConflictedFiles();
  conflictFilesProvider.updateConflictedFiles(conflictedFiles);
}

async function refreshAllConflicts() {
  if (!isExtensionEnabled) {
    return;
  }

  console.log(translate('Refreshing all conflicts...'));
  const targetBranch = conflictFilesProvider.getTargetBranch();

  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme === 'file') {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (workspaceFolder) {
        await checkConflictForDocument(document, workspaceFolder.uri.fsPath, targetBranch);
      }
    }
  }

  const conflictedFiles = getConflictedFiles();
  conflictFilesProvider.updateConflictedFiles(conflictedFiles);
  
  console.log(translate(`Refresh complete. Found ${conflictedFiles.length} conflicted files.`));
}

export function deactivate() {
  console.log(translate('Git Conflict Anticipator deactivated'));
}