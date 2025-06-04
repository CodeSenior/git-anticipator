import * as cp from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';
import { isGitRepo } from '../utils/utils';

const exec = util.promisify(cp.exec);

export async function detectConflicts(targetBranch: string): Promise<Set<string>> {
  try {
    // Récupère les fichiers modifiés sur la branche courante
    const { stdout: currentBranchOutput } = await exec(`git rev-parse --abbrev-ref HEAD`);
    const currentBranch = currentBranchOutput.trim();

    if (currentBranch === targetBranch) {
      vscode.window.showWarningMessage(`Vous êtes déjà sur la branche "${targetBranch}"`);
      return new Set();
    }

    // Vérifie que la branche cible existe
    await exec(`git rev-parse --verify ${targetBranch}`);

    // Récupère les fichiers modifiés uniquement sur la branche courante
    const { stdout: currentChanges } = await exec(`git diff --name-only ${targetBranch}..${currentBranch}`);

    // Récupère les fichiers modifiés uniquement sur la branche cible
    const { stdout: targetChanges } = await exec(`git diff --name-only ${currentBranch}..${targetBranch}`);

    const currentFiles = new Set(currentChanges.split('\n').filter(Boolean));
    const targetFiles = new Set(targetChanges.split('\n').filter(Boolean));

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
  if (await isGitRepo()) {
    const base = await exec(`git merge-base ${localBranch} ${remoteBranch}`);
    const mergeTree = await exec(`git merge-tree ${base.stdout.trim()} ${localBranch} ${remoteBranch}`);
    return mergeTree.stdout.includes('<<<<<<<');
  } else {
    vscode.window.showWarningMessage("This folder is not a Git repository.");
    return false;
  }
}