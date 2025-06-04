import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const conflictDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(255, 0, 0, 0.3)',
  overviewRulerColor: 'red',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
  gutterIconPath: vscode.Uri.file(path.join(__dirname, 'icons', 'conflict.svg')),
  gutterIconSize: 'contain'
});

let conflictedFilesSet = new Set<string>();

// Vérifier si un dossier est un dépôt Git
function isGitRepository(folderPath: string): boolean {
  try {
    return fs.existsSync(path.join(folderPath, '.git'));
  } catch {
    return false;
  }
}

// Exécuter une commande Git avec gestion d'erreur
function executeGitCommand(command: string, cwd: string): string | null {
  try {
    console.log(`Executing: ${command} in ${cwd}`);
    const result = execSync(command, { 
      cwd, 
      encoding: 'utf8',
      timeout: 10000 // 10 secondes timeout
    }).toString().trim();
    console.log(`Result: ${result.substring(0, 100)}...`);
    return result;
  } catch (error: any) {
    console.error(`Git command failed: ${command}`, error.message);
    return null;
  }
}

// Vérifier si une branche existe
function branchExists(branchName: string, cwd: string): boolean {
  const result = executeGitCommand(`git rev-parse --verify ${branchName}`, cwd);
  return result !== null;
}

// Normaliser le nom de branche (gérer les branches remote)
function normalizeBranchName(branchName: string, cwd: string): string | null {
  // Essayer d'abord la branche locale
  if (branchExists(branchName, cwd)) {
    return branchName;
  }

  // Essayer avec origin/
  const remoteBranch = `origin/${branchName}`;
  if (branchExists(remoteBranch, cwd)) {
    console.log(`Using remote branch: ${remoteBranch}`);
    return remoteBranch;
  }

  // Essayer de chercher toutes les branches qui matchent
  const allBranches = executeGitCommand('git branch -a', cwd);
  if (allBranches) {
    const lines = allBranches.split('\n');
    for (const line of lines) {
      const cleanLine = line.trim().replace('* ', '').replace('remotes/', '');
      if (cleanLine.endsWith(`/${branchName}`) || cleanLine === branchName) {
        const foundBranch = cleanLine.startsWith('origin/') ? cleanLine : `origin/${cleanLine}`;
        if (branchExists(foundBranch, cwd)) {
          console.log(`Found matching branch: ${foundBranch}`);
          return foundBranch;
        }
      }
    }
  }

  return null;
}

// Méthode alternative : détecter les conflits sans merge-tree --name-only
function detectPotentialConflicts(base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): string[] {
  console.log('Detecting conflicts using diff-based approach');
  
  // Obtenir les fichiers modifiés dans chaque branche depuis la base commune
  const currentChanges = executeGitCommand(`git diff --name-only ${base}..${currentBranch}`, wsFolderPath);
  const targetChanges = executeGitCommand(`git diff --name-only ${base}..${targetBranch}`, wsFolderPath);
  
  if (!currentChanges || !targetChanges) {
    console.error('Could not get file changes');
    return [];
  }
  
  const currentFiles = new Set(currentChanges.split('\n').filter(f => f.trim() !== ''));
  const targetFiles = new Set(targetChanges.split('\n').filter(f => f.trim() !== ''));
  
  // Fichiers modifiés des deux côtés = conflits potentiels
  const potentialConflicts: string[] = [];
  for (const file of currentFiles) {
    if (targetFiles.has(file)) {
      potentialConflicts.push(file);
    }
  }
  
  console.log(`Found ${potentialConflicts.length} potentially conflicted files:`, potentialConflicts);
  return potentialConflicts;
}

// Vérifier s'il y a des conflits réels pour un fichier spécifique
function hasRealConflicts(filePath: string, base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): boolean {
  try {
    console.log(`Checking real conflicts for: ${filePath}`);
    
    // Utiliser git merge-tree classique (sans --name-only) pour obtenir le contenu fusionné
    const mergeResult = executeGitCommand(`git merge-tree ${base} ${currentBranch} ${targetBranch}`, wsFolderPath);
    
    if (!mergeResult) {
      console.log('No merge-tree result, assuming no conflicts');
      return false;
    }
    
    // Chercher les marqueurs de conflit dans la sortie
    const hasConflictMarkers = mergeResult.includes('<<<<<<<') || 
                               mergeResult.includes('=======') || 
                               mergeResult.includes('>>>>>>>');
    
    if (hasConflictMarkers) {
      console.log(`Real conflicts found in ${filePath}`);
      return true;
    }
    
    // Méthode alternative : vérifier si le fichier apparaît dans la sortie de merge-tree
    // Si merge-tree retourne du contenu pour ce fichier, il y a probablement des conflits
    const lines = mergeResult.split('\n');
    const fileInOutput = lines.some(line => line.includes(filePath));
    
    console.log(`File ${filePath} ${fileInOutput ? 'found' : 'not found'} in merge-tree output`);
    return fileInOutput;
    
  } catch (error) {
    console.error(`Error checking conflicts for ${filePath}:`, error);
    return false;
  }
}

// Analyser les conflits dans le contenu d'un fichier
function analyzeFileConflicts(document: vscode.TextDocument, filePath: string, base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): number[] {
  try {
    // Obtenir le contenu du fichier depuis chaque branche
    const currentContent = executeGitCommand(`git show ${currentBranch}:${filePath}`, wsFolderPath);
    const targetContent = executeGitCommand(`git show ${targetBranch}:${filePath}`, wsFolderPath);
    const baseContent = executeGitCommand(`git show ${base}:${filePath}`, wsFolderPath);
    
    if (!currentContent || !targetContent || !baseContent) {
      console.log('Could not get file content from branches');
      return [];
    }
    
    // Méthode simple : comparer ligne par ligne
    const currentLines = currentContent.split('\n');
    const targetLines = targetContent.split('\n');
    const baseLines = baseContent.split('\n');
    const docLines = document.getText().split('\n');
    
    const conflictLines: number[] = [];
    
    // Identifier les lignes qui ont changé différemment dans les deux branches
    const maxLines = Math.max(currentLines.length, targetLines.length, baseLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const baseLine = baseLines[i] || '';
      const currentLine = currentLines[i] || '';
      const targetLine = targetLines[i] || '';
      
      // Si la ligne a changé différemment dans les deux branches
      if (baseLine !== currentLine && baseLine !== targetLine && currentLine !== targetLine) {
        // Essayer de trouver cette ligne dans le document actuel
        for (let docLineIndex = 0; docLineIndex < docLines.length; docLineIndex++) {
          const docLine = docLines[docLineIndex];
          if (docLine.trim() === currentLine.trim() || docLine.trim() === targetLine.trim()) {
            conflictLines.push(docLineIndex);
            break;
          }
        }
      }
    }
    
    return [...new Set(conflictLines)]; // Supprimer les doublons
    
  } catch (error) {
    console.error('Error analyzing file conflicts:', error);
    return [];
  }
}

export async function checkConflictForDocument(document: vscode.TextDocument, wsFolderPath: string, targetBranch: string) {
  console.log(`Checking conflicts for: ${document.uri.fsPath}`);
  console.log(`Workspace: ${wsFolderPath}, Target branch: ${targetBranch}`);

  if (document.uri.scheme !== 'file') {
    console.log('Document is not a file, skipping');
    return;
  }

  // Vérifier que c'est un dépôt Git
  if (!isGitRepository(wsFolderPath)) {
    console.error(`Not a git repository: ${wsFolderPath}`);
    clearDecorations(document);
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath, false);
  console.log(`Relative path: ${relativePath}`);

  // Obtenir la branche courante
  const currentBranch = executeGitCommand('git rev-parse --abbrev-ref HEAD', wsFolderPath);
  if (!currentBranch) {
    console.error('Could not get current branch');
    clearDecorations(document);
    return;
  }
  console.log(`Current branch: ${currentBranch}`);

  // Normaliser le nom de la branche cible
  const normalizedTargetBranch = normalizeBranchName(targetBranch, wsFolderPath);
  if (!normalizedTargetBranch) {
    console.error(`Target branch ${targetBranch} does not exist`);
    clearDecorations(document);
    return;
  }

  // Si on est déjà sur la branche cible, pas de conflit possible
  if (currentBranch === normalizedTargetBranch || currentBranch === targetBranch) {
    console.log('Already on target branch, no conflicts possible');
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }

  // Obtenir la base commune
  const base = executeGitCommand(`git merge-base ${currentBranch} ${normalizedTargetBranch}`, wsFolderPath);
  if (!base) {
    console.error(`Could not find merge base between ${currentBranch} and ${normalizedTargetBranch}`);
    clearDecorations(document);
    return;
  }
  console.log(`Merge base: ${base}`);

  // Détecter les conflits potentiels
  const potentialConflicts = detectPotentialConflicts(base, currentBranch, normalizedTargetBranch, wsFolderPath);
  
  // Vérifier si le fichier actuel est dans les conflits potentiels
  if (!potentialConflicts.includes(relativePath)) {
    console.log(`No potential conflicts for ${relativePath}`);
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }
  
  // Vérifier s'il y a de vrais conflits
  const hasConflicts = hasRealConflicts(relativePath, base, currentBranch, normalizedTargetBranch, wsFolderPath);
  
  if (!hasConflicts) {
    console.log(`No real conflicts detected for ${relativePath}`);
    clearDecorations(document);
    conflictedFilesSet.delete(document.uri.fsPath);
    return;
  }

  console.log(`Conflicts confirmed for ${relativePath}`);

  // Analyser les lignes en conflit
  const conflictLineNumbers = analyzeFileConflicts(document, relativePath, base, currentBranch, normalizedTargetBranch, wsFolderPath);
  
  let decorations: vscode.Range[] = [];
  
  if (conflictLineNumbers.length > 0) {
    // Décorer les lignes spécifiques en conflit
    decorations = conflictLineNumbers.map(lineNum => {
      const line = Math.min(lineNum, document.lineCount - 1);
      return document.lineAt(line).range;
    });
    console.log(`Decorating ${conflictLineNumbers.length} specific conflict lines`);
  } else {
    // Fallback : décorer tout le fichier
    decorations = [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
    console.log('Decorating entire file as fallback');
  }

  const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());

  if (editor && decorations.length > 0) {
    editor.setDecorations(conflictDecorationType, decorations);
    conflictedFilesSet.add(document.uri.fsPath);
    console.log('Applied conflict decorations');
    
    // Afficher un message informatif
    vscode.window.showWarningMessage(
      `Conflits détectés dans ${path.basename(document.uri.fsPath)} avec la branche ${targetBranch}`,
      'Voir les conflits'
    ).then(selection => {
      if (selection === 'Voir les conflits') {
        vscode.commands.executeCommand('workbench.view.extension.gitConflictAnticipator');
      }
    });
  }

  // Mettre à jour TreeView
  vscode.commands.executeCommand('gitConflictAnticipator.refreshTree');
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
  console.log(`Setting up workspace watcher for: ${wsFolderPath}`);
  
  // Vérifier que c'est un dépôt Git
  if (!isGitRepository(wsFolderPath)) {
    console.error(`Cannot watch non-git directory: ${wsFolderPath}`);
    return;
  }

  // Écouter changements dans tous les fichiers du workspace
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

  // Pour chaque fichier modifié, relancer la détection
  fileWatcher.onDidChange(async (uri) => {
    try {
      console.log(`File changed: ${uri.fsPath}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await checkConflictForDocument(doc, wsFolderPath, targetBranch);
      if (conflictFilesProvider && conflictFilesProvider.refresh) {
        conflictFilesProvider.refresh(uri.fsPath);
      }
    } catch (error) {
      console.error('Error handling file change:', error);
    }
  });

  fileWatcher.onDidCreate(async (uri) => {
    try {
      console.log(`File created: ${uri.fsPath}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await checkConflictForDocument(doc, wsFolderPath, targetBranch);
      if (conflictFilesProvider && conflictFilesProvider.refresh) {
        conflictFilesProvider.refresh(uri.fsPath);
      }
    } catch (error) {
      console.error('Error handling file creation:', error);
    }
  });

  fileWatcher.onDidDelete((uri) => {
    console.log(`File deleted: ${uri.fsPath}`);
    conflictedFilesSet.delete(uri.fsPath);
    if (conflictFilesProvider && conflictFilesProvider.refresh) {
      conflictFilesProvider.refresh(uri.fsPath);
    }
  });

  context.subscriptions.push(fileWatcher);
  console.log('Workspace watcher setup complete');
}

// Fonction utilitaire pour obtenir les fichiers en conflit
export function getConflictedFiles(): string[] {
  return Array.from(conflictedFilesSet);
}

// Fonction pour nettoyer un fichier spécifique des conflits
export function removeFileFromConflicts(filePath: string): void {
  conflictedFilesSet.delete(filePath);
}