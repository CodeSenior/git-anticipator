 
import * as vscode from 'vscode';
import { isGitRepo } from '../utils/utils';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function detectConflicts(targetBranch: string): Promise<Set<string>> {
  try {
    // Récupère les fichiers modifiés sur la branche courante
    const { stdout: currentBranchOutput } = await execAsync(`git rev-parse --abbrev-ref HEAD`);
    const currentBranch = currentBranchOutput ? currentBranchOutput.trim() : '';

    if (currentBranch === targetBranch) {
      vscode.window.showWarningMessage(`Vous êtes déjà sur la branche "${targetBranch}"`);
      return new Set();
    }
   

    // Vérifie que la branche cible existe
    await execAsync(`git rev-parse --verify ${targetBranch}`);

    // Récupère les fichiers modifiés uniquement sur la branche courante
    const { stdout: currentChanges } = await execAsync(`git diff --name-only ${targetBranch}..${currentBranch}`);

    // Récupère les fichiers modifiés uniquement sur la branche cible
    const { stdout: targetChanges } = await execAsync(`git diff --name-only ${currentBranch}..${targetBranch}`);

    const currentFiles = new Set(currentChanges?.toString().split('\n').filter(Boolean) ?? []);
    const targetFiles = new Set(targetChanges?.toString().split('\n').filter(Boolean) ?? []);

    // Cherche les fichiers modifiés dans les deux branches = potentiels conflits
    const conflicts = new Set<string>();
    for (const file of currentFiles) {
      if (targetFiles.has(file)) {
        conflicts.add(file);
      }
    }

    return conflicts;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Erreur lors de la détection des conflits : ${error.message}`);
    return new Set();
  }
}

export async function hasPotentialConflicts(localBranch: string, remoteBranch: string): Promise<boolean> {
const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("No workspace folder found.");
    return false;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  if (await isGitRepo()) {
    try {
      const base = await execAsync(`git merge-base ${localBranch} ${remoteBranch}`, {
        cwd: workspacePath
      });
      
      const mergeTree = await execAsync(`git merge-tree ${base.stdout.trim()} ${localBranch} ${remoteBranch}`, {
        cwd: workspacePath
      });
      
      return mergeTree.stdout.includes('<<<<<<<');
    } catch (error) {
      console.error('Error checking conflicts:', error);
      vscode.window.showErrorMessage(`Error checking conflicts: ${error}`);
      return false;
    }
  } else {
    vscode.window.showWarningMessage("This folder is not a Git repository.");
    return false;
  }
}