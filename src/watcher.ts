import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { translate } from './language';
import { DiagnosticPanel } from './webview/diagnosticPanel';
import { detectConflicts } from './conflictScanner/detectConflicts';
import connectivity from './connectivity/connectivity';
import { executeGitCommand } from './command/command';
import { normalizeBranchName } from './utils/utils';

const systemLanguage = vscode.env.language;

const conflictDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(255, 0, 0, 0.3)',
  overviewRulerColor: 'red',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  gutterIconPath: vscode.Uri.file(path.join(__dirname, 'icons', 'conflict.svg')),
  gutterIconSize: 'contain'
});

let conflictedFilesSet = new Set<string>();
let isOnline = true;

// Vérifier si un dossier est un dépôt Git
function isGitRepository(folderPath: string): boolean {
  try {
    return fs.existsSync(path.join(folderPath, '.git'));
  } catch {
    return false;
  }
}

// Fonction pour détecter les conflits entre branche locale et remote
function detectLocalRemoteConflicts(localBranch: string, remoteBranch: string, wsFolderPath: string): string[] {
  console.log(translate(`Detecting conflicts between local ${localBranch} and remote ${remoteBranch}`));
  
  // Obtenir le dernier commit de chaque branche
  const localCommit = executeGitCommand(`git rev-parse ${localBranch}`, wsFolderPath);
  const remoteCommit = executeGitCommand(`git rev-parse ${remoteBranch}`, wsFolderPath);
  
  if (!localCommit || !remoteCommit) {
    console.error(translate('Could not get commit hashes'));
    return [];
  }
  
  // Si les commits sont identiques, pas de conflits
  if (localCommit === remoteCommit) {
    console.log(translate('Local and remote are synchronized, no conflicts'));
    return [];
  }
  
  // Trouver la base commune
  const mergeBase = executeGitCommand(`git merge-base ${localBranch} ${remoteBranch}`, wsFolderPath);
  if (!mergeBase) {
    console.error(translate('Could not find merge base'));
    return [];
  }
  
  // Obtenir les fichiers modifiés dans chaque branche depuis la base commune
  const localChanges = executeGitCommand(`git diff --name-only ${mergeBase}..${localBranch}`, wsFolderPath);
  const remoteChanges = executeGitCommand(`git diff --name-only ${mergeBase}..${remoteBranch}`, wsFolderPath);
  
  if (!localChanges && !remoteChanges) {
    console.log(translate('No changes in either branch'));
    return [];
  }
  
  if (!localChanges || localChanges.trim() === '') {
    console.log(translate('No local changes, no conflicts possible'));
    return [];
  }
  
  if (!remoteChanges || remoteChanges.trim() === '') {
    console.log(translate('No remote changes, no conflicts possible'));
    return [];
  }
  
  // Traiter les listes de fichiers
  const localFiles = new Set(
    localChanges.split('\n').map(f => f.trim()).filter(f => f !== '')
  );
  
  const remoteFiles = new Set(
    remoteChanges.split('\n').map(f => f.trim()).filter(f => f !== '')
  );
  
  // Trouver les fichiers modifiés dans les deux branches
  const conflictedFiles: string[] = [];
  for (const file of localFiles) {
    if (remoteFiles.has(file)) {
      conflictedFiles.push(file);
    }
  }
  
  console.log(translate(`Local files (${localFiles.size}): ${Array.from(localFiles).slice(0, 3).join(', ')}`));
  console.log(translate(`Remote files (${remoteFiles.size}): ${Array.from(remoteFiles).slice(0, 3).join(', ')}`));
  console.log(translate(`Conflicted files (${conflictedFiles.length}): ${conflictedFiles.join(', ')}`));
  
  return conflictedFiles;
}

// Alternative method: detect conflicts without merge-tree --name-only
function detectPotentialConflicts(base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): string[] {
  console.log(translate('Detecting conflicts using diff-based approach'));
  
  // Log detailed information for debugging
  console.log(translate(`Base: ${base}`));
  console.log(translate(`Current branch: ${currentBranch}`));
  console.log(translate(`Target branch: ${targetBranch}`));
  console.log(translate(`Working directory: ${wsFolderPath}`));
  
  // Cas spécial: si on compare une branche locale avec sa version remote
  if (currentBranch === targetBranch.replace(/^origin\//, '')) {
    console.log(translate('Detecting local vs remote conflicts'));
    return detectLocalRemoteConflicts(currentBranch, targetBranch, wsFolderPath);
  }
  
  // Vérifier d'abord que toutes les références existent
  const baseExists = executeGitCommand(`git cat-file -e ${base}`, wsFolderPath);
  const currentExists = executeGitCommand(`git cat-file -e ${currentBranch}`, wsFolderPath);
  const targetExists = executeGitCommand(`git cat-file -e ${targetBranch}`, wsFolderPath);
  
  if (baseExists === null) {
    console.error(translate(`Base commit ${base} does not exist`));
    return [];
  }
  if (currentExists === null) {
    console.error(translate(`Current branch ${currentBranch} does not exist`));
    return [];
  }
  if (targetExists === null) {
    console.error(translate(`Target branch ${targetBranch} does not exist`));
    return [];
  }
  
  // Essayer plusieurs approches pour obtenir les fichiers modifiés
  let currentChanges: string | null = null;
  let targetChanges: string | null = null;
  
  // Approche 1: Utiliser la syntaxe standard
  currentChanges = executeGitCommand(`git diff --name-only ${base}..${currentBranch}`, wsFolderPath);
  targetChanges = executeGitCommand(`git diff --name-only ${base}..${targetBranch}`, wsFolderPath);
  
  // Approche 2: Si l'approche 1 échoue, essayer avec des guillemets
  if (!currentChanges || !targetChanges) {
    console.log(translate('First approach failed, trying alternative syntax'));
    currentChanges = executeGitCommand(`git diff --name-only "${base}" "${currentBranch}"`, wsFolderPath);
    targetChanges = executeGitCommand(`git diff --name-only "${base}" "${targetBranch}"`, wsFolderPath);
  }
  
  // Approche 3: Utiliser les SHA complets si possible
  if (!currentChanges || !targetChanges) {
    console.log(translate('Second approach failed, trying with full SHA'));
    const baseSha = executeGitCommand(`git rev-parse ${base}`, wsFolderPath);
    const currentSha = executeGitCommand(`git rev-parse ${currentBranch}`, wsFolderPath);
    const targetSha = executeGitCommand(`git rev-parse ${targetBranch}`, wsFolderPath);
    
    if (baseSha && currentSha && targetSha) {
      currentChanges = executeGitCommand(`git diff --name-only ${baseSha}..${currentSha}`, wsFolderPath);
      targetChanges = executeGitCommand(`git diff --name-only ${baseSha}..${targetSha}`, wsFolderPath);
    }
  }
  
  console.log(translate(`Current changes result: ${currentChanges ? 'SUCCESS' : 'FAILED'}`));
  console.log(translate(`Target changes result: ${targetChanges ? 'SUCCESS' : 'FAILED'}`));
  
  // Handle error cases
  if (currentChanges === null && targetChanges === null) {
    console.error(translate('All approaches failed to get file changes'));
    return [];
  }
  
  // Si une seule branche a des changements, pas de conflits possibles
  if (!currentChanges || currentChanges.trim() === '') {
    console.log(translate('No changes in current branch, no conflicts possible'));
    return [];
  }
  
  if (!targetChanges || targetChanges.trim() === '') {
    console.log(translate('No changes in target branch, no conflicts possible'));
    return [];
  }
  
  console.log(translate(`Current changes: ${currentChanges.substring(0, 200)}${currentChanges.length > 200 ? '...' : ''}`));
  console.log(translate(`Target changes: ${targetChanges.substring(0, 200)}${targetChanges.length > 200 ? '...' : ''}`));
  
  // Process and filter file lists
  const currentFiles = new Set(
    currentChanges
      .split('\n')
      .map(f => f.trim())
      .filter(f => f !== '' && !f.startsWith('#') && !isDirectory(f, wsFolderPath))
  );
  
  const targetFiles = new Set(
    targetChanges
      .split('\n')
      .map(f => f.trim())
      .filter(f => f !== '' && !f.startsWith('#') && !isDirectory(f, wsFolderPath))
  );
  
  // Find files modified in both branches = potential conflicts
  const potentialConflicts: string[] = [];
  for (const file of currentFiles) {
    if (targetFiles.has(file)) {
      potentialConflicts.push(file);
    }
  }
  
  console.log(translate(`Files modified in current branch (${currentFiles.size}): ${Array.from(currentFiles).slice(0, 5).join(', ')}${currentFiles.size > 5 ? '...' : ''}`));
  console.log(translate(`Files modified in target branch (${targetFiles.size}): ${Array.from(targetFiles).slice(0, 5).join(', ')}${targetFiles.size > 5 ? '...' : ''}`));
  console.log(translate(`Found ${potentialConflicts.length} potentially conflicted files: ${potentialConflicts.join(', ')}`));
  
  return potentialConflicts;
}
// Version améliorée de la détection des conflits
function detectConflictFiles(base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): string[] {
  console.log(translate(`Detecting conflicts between ${currentBranch} and ${targetBranch} from base ${base}`));
  
  // Méthode 1: Utiliser git diff avec trois points pour voir les changements
  const conflictCheck = executeGitCommand(`git diff --name-only ${currentBranch}...${targetBranch}`, wsFolderPath);
  if (conflictCheck !== null) {
    const potentialConflicts = conflictCheck.split('\n').filter(f => f.trim() !== '');
    console.log(translate(`Files with differences: ${potentialConflicts.join(', ')}`));
    
    // Filtrer pour ne garder que les vrais conflits
    const realConflicts: string[] = [];
    for (const file of potentialConflicts) {
      if (hasRealConflict(file, base, currentBranch, targetBranch, wsFolderPath)) {
        realConflicts.push(file);
      }
    }
    
    return realConflicts;
  }
  
  // Méthode 2: Fallback - comparer les modifications de chaque branche
  const currentModified = executeGitCommand(`git diff --name-only ${base}..${currentBranch}`, wsFolderPath);
  const targetModified = executeGitCommand(`git diff --name-only ${base}..${targetBranch}`, wsFolderPath);
  
  if (!currentModified) {
    console.error(translate('Could not get current branch modifications'));
    return [];
  }
  
  if (!targetModified) {
    console.error(translate('Could not get target branch modifications'));
    // Essayer une approche alternative
    const alternativeTarget = executeGitCommand(`git diff --name-only ${base} ${targetBranch}`, wsFolderPath);
    if (!alternativeTarget) {
      console.error(translate('Alternative target branch query also failed'));
      return [];
    } else {
      console.log(translate('Used alternative query for target branch'));
    }
  }
  
  const currentFiles = new Set(currentModified.split('\n').filter(f => f.trim() !== ''));
  const targetFiles = new Set((targetModified || '').split('\n').filter(f => f.trim() !== ''));
  
  // Intersection = fichiers modifiés des deux côtés = conflits potentiels
  const conflicts: string[] = [];
  for (const file of currentFiles) {
    if (targetFiles.has(file)) {
      if (hasRealConflict(file, base, currentBranch, targetBranch, wsFolderPath)) {
        conflicts.push(file);
      }
    }
  }
  
  console.log(translate(`Current branch modified: ${Array.from(currentFiles).join(', ')}`));
  console.log(translate(`Target branch modified: ${Array.from(targetFiles).join(', ')}`));
  console.log(translate(`Real conflicts: ${conflicts.join(', ')}`));
  
  return conflicts;
}

// Fonction améliorée pour détecter les vrais conflits
function hasRealConflict(filePath: string, base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): boolean {
  try {
    console.log(translate(`Checking real conflicts for: ${filePath}`));
    
    // Vérifier que le fichier existe dans toutes les versions
    const fileExistsInBase = executeGitCommand(`git cat-file -e ${base}:${filePath}`, wsFolderPath) !== null;
    const fileExistsInCurrent = executeGitCommand(`git cat-file -e ${currentBranch}:${filePath}`, wsFolderPath) !== null;
    const fileExistsInTarget = executeGitCommand(`git cat-file -e ${targetBranch}:${filePath}`, wsFolderPath) !== null;
    
    // Si le fichier n'existe que dans une branche, c'est un conflit de création/suppression
    if (!fileExistsInBase && (fileExistsInCurrent !== fileExistsInTarget)) {
      console.log(translate(`File creation/deletion conflict for ${filePath}`));
      return true;
    }
    
    // Si le fichier n'existe nulle part, pas de conflit
    if (!fileExistsInCurrent && !fileExistsInTarget) {
      return false;
    }
    
    // Obtenir le contenu du fichier depuis chaque commit
    const baseContent = fileExistsInBase ? executeGitCommand(`git show ${base}:${filePath}`, wsFolderPath) : '';
    const currentContent = fileExistsInCurrent ? executeGitCommand(`git show ${currentBranch}:${filePath}`, wsFolderPath) : '';
    const targetContent = fileExistsInTarget ? executeGitCommand(`git show ${targetBranch}:${filePath}`, wsFolderPath) : '';
    
    // Si les deux branches ont le même contenu, pas de conflit
    if (currentContent === targetContent) {
      console.log(translate(`Same content in both branches for ${filePath}, no conflict`));
      return false;
    }
    
    // Si une seule branche a changé par rapport à la base, pas de conflit
    if (baseContent === currentContent && baseContent !== targetContent) {
      console.log(translate(`Only target branch changed ${filePath}, no conflict`));
      return false;
    }
    
    if (baseContent === targetContent && baseContent !== currentContent) {
      console.log(translate(`Only current branch changed ${filePath}, no conflict`));
      return false;
    }
    
    // Méthode avancée: essayer un merge à blanc pour voir s'il y aurait des conflits
    const mergeTest = executeGitCommand(`git merge-tree ${base} ${currentBranch} ${targetBranch}`, wsFolderPath);
    if (mergeTest) {
      const hasConflictMarkers = mergeTest.includes('<<<<<<<') || mergeTest.includes('>>>>>>>') || mergeTest.includes('=======');
      if (hasConflictMarkers) {
        console.log(translate(`Merge test confirms conflict for ${filePath}`));
        return true;
      }
    }
    
    // Les deux branches ont changé différemment = conflit probable
    console.log(translate(`Both branches changed ${filePath} differently, likely conflict`));
    return true;
    
  } catch (error) {
    console.error(`Error checking real conflicts for ${filePath}:`, error);
    // En cas d'erreur, assumons qu'il y a conflit pour être sûr
    return true;
  }
}

// Fonction utilitaire pour vérifier si un chemin est un répertoire
function isDirectory(filePath: string, wsFolderPath: string): boolean {
  try {
    const fullPath = path.join(wsFolderPath, filePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  } catch (error) {
    return false;
  }
}

export async function checkConflictForDocument(document: vscode.TextDocument, wsFolderPath: string, targetBranch: string) {
  console.log(`\n=== Checking conflicts for: ${document.uri.fsPath} ===`);
  console.log(translate(`Workspace: ${wsFolderPath}`));
  console.log(translate(`Target branch: ${targetBranch}`));

  if (document.uri.scheme !== 'file') {
    console.log(translate('Document is not a file, skipping'));
    return;
  }

  // Vérifier que le document est un fichier et non un répertoire
  try {
    const stat = fs.statSync(document.uri.fsPath);
    if (stat.isDirectory()) {
      console.log(translate('Document is a directory, skipping'));
      return;
    }
  } catch (error) {
    console.log(translate('Could not stat document, skipping'));
    return;
  }

  // Vérifier que c'est un dépôt Git
  if (!isGitRepository(wsFolderPath)) {
    console.error(translate(`Not a git repository: ${wsFolderPath}`));
    clearDecorations(document);
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath, false);
  console.log(translate(`Relative path: ${relativePath}`));

  // Ignorer certains fichiers/dossiers
  if (relativePath.startsWith('.vscode/') || 
      relativePath.startsWith('.git/') || 
      relativePath.startsWith('node_modules/')) {
    console.log(translate(`Ignoring system file: ${relativePath}`));
    clearDecorations(document);
    return;
  }

  // Obtenir la branche courante
  let currentBranch = executeGitCommand('git rev-parse --abbrev-ref HEAD', wsFolderPath);
  if (!currentBranch) {
    console.error(translate('Could not get current branch'));
    clearDecorations(document);
    return;
  }
  console.log(translate(`Current branch: ${currentBranch}`));

  // Normaliser le nom de la branche cible
  const normalizedTargetBranch = normalizeBranchName(targetBranch, wsFolderPath);
  if (!normalizedTargetBranch) {
    console.error(translate(`Target branch ${targetBranch} does not exist`));
    let message = '';
    if (systemLanguage.startsWith('fr')) {
      message = translate(`La branche ${targetBranch} n'existe pas`);
    } else {
      message = translate(`The branch ${targetBranch} does not exist`);
    }
    vscode.window.showErrorMessage(message);
    clearDecorations(document);
    return;
  }
  console.log(translate(`Normalized target branch: ${normalizedTargetBranch}`));

  // Si on compare la même branche locale avec elle-même, pas de conflit
  /*if (currentBranch === normalizedTargetBranch) {
    console.log(translate('Comparing same branch with itself, no conflicts possible'));
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }*/

  // Obtenir la base commune
  let base = executeGitCommand(`git merge-base ${currentBranch} ${normalizedTargetBranch}`, wsFolderPath);
  if (!base) {
    console.error(translate(`Could not find merge base between ${currentBranch} and ${normalizedTargetBranch}`));
    clearDecorations(document);
    return;
  }
  console.log(translate(`Merge base: ${base}`));

  // Détecter les conflits potentiels
  const potentialConflicts = detectPotentialConflicts(base, currentBranch, normalizedTargetBranch, wsFolderPath);
  
  // Si aucun conflit potentiel détecté
  if (potentialConflicts.length === 0) {
    console.log(translate('No potential conflicts detected'));
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }

  // Vérifier si le fichier actuel est dans les conflits potentiels
  if (!potentialConflicts.includes(relativePath)) {
    console.log(translate(`No potential conflicts for ${relativePath}`));
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }

    // Détecter les fichiers en conflit
    const conflictFiles = detectConflictFiles(base, currentBranch, normalizedTargetBranch, wsFolderPath);
  
    // Vérifier si le fichier actuel est concerné
    if (!conflictFiles.includes(relativePath)) {
      console.log(`File ${relativePath} not in conflict list`);
      clearDecorations(document);
      conflictedFilesSet.delete(document.uri.fsPath);
      return;
    }

  console.log(translate(`CONFLICT CONFIRMED for ${relativePath}`));

  // Décorer le fichier
  const decorations = [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
  const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());

  if (editor) {
    editor.setDecorations(conflictDecorationType, decorations);
    conflictedFilesSet.add(document.uri.fsPath);
    console.log(translate('Applied conflict decorations to entire file'));
    
    // Afficher un message informatif
    let message = '';
    if (systemLanguage.startsWith('fr')) {
      message = translate(`Conflits détectés dans ${path.basename(document.uri.fsPath)} avec la branche ${targetBranch}`);
    } else {
      message = translate(`Conflicts detected in ${path.basename(document.uri.fsPath)} with branch ${targetBranch}`);
    }
    vscode.window.showWarningMessage(
      message,
      translate('See conflicts')
    ).then(selection => {
      if (selection === translate('See conflicts')) {
        vscode.commands.executeCommand('workbench.view.extension.gitConflictAnticipator');
      }
    });
  }

  // Mettre à jour TreeView
  vscode.commands.executeCommand('gitConflictAnticipator.refreshTree');
  console.log(translate(`=== End conflict check for ${relativePath} ===\n`));

}

export function clearDecorations(document: vscode.TextDocument) {
  const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
  if (editor) {
    editor.setDecorations(conflictDecorationType, []);
  }
  conflictedFilesSet.delete(document.uri.fsPath);
}

// Watcher sur workspace avec vérification Git
export function watchWorkspace(wsFolderPath: string, targetBranch: string, conflictFilesProvider: any, context: vscode.ExtensionContext) {
  console.log(translate(`Setting up workspace watcher for: ${wsFolderPath}`));
  
  // Vérifier que c'est un dépôt Git
  if (!isGitRepository(wsFolderPath)) {
    console.error(translate(`Cannot watch non-git directory: ${wsFolderPath}`));
    return;
  }

  // Écouter changements dans tous les fichiers du workspace, en excluant les fichiers Git
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);

  // Pour chaque fichier modifié, relancer la détection
  fileWatcher.onDidChange(async (uri) => {
    try {
      // Ignorer les fichiers Git
      if (uri.fsPath.includes('.git/')) {
        return;
      }
      console.log(translate(`File changed: ${uri.fsPath}`));
      const doc = await vscode.workspace.openTextDocument(uri);
      await checkConflictForDocument(doc, wsFolderPath, targetBranch);
      if (conflictFilesProvider && conflictFilesProvider.refresh) {
        conflictFilesProvider.refresh(uri.fsPath);
      }
    } catch (error) {
      console.error(translate('Error handling file change:'), error);
    }
  });

  fileWatcher.onDidCreate(async (uri) => {
    try {
      // Ignorer les fichiers Git
      if (uri.fsPath.includes('.git/')) {
        return;
      }
      console.log(translate(`File created: ${uri.fsPath}`));
      const doc = await vscode.workspace.openTextDocument(uri);
      await checkConflictForDocument(doc, wsFolderPath, targetBranch);
      if (conflictFilesProvider && conflictFilesProvider.refresh) {
        conflictFilesProvider.refresh(uri.fsPath);
      }
    } catch (error) {
      console.error(translate('Error handling file creation:'), error);
    }
  });

  fileWatcher.onDidDelete((uri) => {
    // Ignorer les fichiers Git
    if (uri.fsPath.includes('.git/')) {
      return;
    }
    console.log(translate(`File deleted: ${uri.fsPath}`));
    conflictedFilesSet.delete(uri.fsPath);
    if (conflictFilesProvider && conflictFilesProvider.refresh) {
      conflictFilesProvider.refresh(uri.fsPath);
    }
  });

  // Écouter les changements dans le dossier .git pour actualiser les branches
  const gitDirWatcher = vscode.workspace.createFileSystemWatcher('.git/**/*');
  gitDirWatcher.onDidChange(async (uri) => {
    console.log(translate(`Git directory changed: ${uri.fsPath}`));
    // Actualiser les branches
    const branches = executeGitCommand('git branch -a', wsFolderPath);
    console.log(translate('Available branches:') + branches);
  });

  const showConflictPanel = vscode.commands.registerCommand('extension.showConflictPanel', async () => {
    const targetBranch = 'main'; // Ou récupéré dynamiquement depuis la config
    const conflicts = await detectConflicts(targetBranch);
    DiagnosticPanel.createOrShow(context.extensionUri, Array.from(conflicts));
  });

  context.subscriptions.push(fileWatcher, showConflictPanel);
  console.log(translate('Workspace watcher setup complete'));
}

// Fonction utilitaire pour obtenir les fichiers en conflit
export function getConflictedFiles(): string[] {
  return Array.from(conflictedFilesSet);
}

// Fonction pour nettoyer un fichier spécifique des conflits
export function removeFileFromConflicts(filePath: string): void {
  conflictedFilesSet.delete(filePath);
}

// Fonction utilitaire pour déboguer les branches
export function debugBranches(wsFolderPath: string): void {
  console.log(translate('=== DEBUG: Available branches ==='));
  const localBranches = executeGitCommand('git branch', wsFolderPath);
  const remoteBranches = executeGitCommand('git branch -r', wsFolderPath);
  const allRefs = executeGitCommand('git show-ref', wsFolderPath);
  
  console.log(translate('Local branches:') + localBranches);
  console.log(translate('Remote branches:') + remoteBranches);
  console.log(translate('All refs:') + allRefs);
  console.log(translate('=== END DEBUG ==='));
}

// Fonctions utilitaires pour la gestion de la connectivité
export function getConnectivityStatus(): boolean {
  return isOnline;
}

export function forceConnectivityCheck(): void {
  connectivity.checkConnectivityAndUpdate();
}

// Initialiser la surveillance de connectivité (à appeler depuis l'activation de l'extension)
export function initializeConnectivityMonitoring(): void {
  connectivity.startConnectivityMonitoring();
}

// Nettoyer la surveillance de connectivité (à appeler depuis la désactivation de l'extension)
export function cleanupConnectivityMonitoring(): void {
  connectivity.stopConnectivityMonitoring();
}