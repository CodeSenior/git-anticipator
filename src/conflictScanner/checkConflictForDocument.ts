import * as vscode from 'vscode';
import * as fs from 'fs';
import { translate } from '../language';
import { clearDecorations } from '../watcher';
import { executeGitCommand } from '../command/command';
import { isGitRepository, normalizeBranchName } from '../utils/utils';
import { detectConflictFiles, detectPotentialConflicts } from './detectConflicts';
import { conflictDecorationType, conflictedFilesSet } from '../types/types';
import path from 'path';

const systemLanguage = vscode.env.language;

/**
 * Checks a given document for conflicts against a target branch in a Git repository.
 * 
 * @param {vscode.TextDocument} document - The document to check for conflicts.
 * @param {string} wsFolderPath - The path to the workspace folder.
 * @param {string} targetBranch - The name of the target branch to check for conflicts against.
 */
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