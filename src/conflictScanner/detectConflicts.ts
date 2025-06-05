 
import * as vscode from 'vscode';
import { isDirectory, isGitRepo } from '../utils/utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import { translate } from '../language';
import { executeGitCommand } from '../command/command';

const execAsync = promisify(exec);

/**
 * Detects conflicts between the current branch and a target branch.
 * 
 * @param targetBranch - The name of the target branch to check for conflicts against.
 * @returns A Set of files that have potential conflicts.
 */
export async function detectConflicts(targetBranch: string): Promise<Set<string>> {
  try {
    // Récupère les fichiers modifiés sur la branche courante
    let currentBranchOutput;
    try {
      const result = await execAsync(`git rev-parse --abbrev-ref HEAD`);
      currentBranchOutput = result.stdout;
    } catch (error) {
      console.error('Error executing git command:', error);
      throw error;
    }
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


/**
 * Checks if there are potential conflicts between a local branch and a remote branch.
 * 
 * @param localBranch - The name of the local branch.
 * @param remoteBranch - The name of the remote branch.
 * @returns A boolean indicating whether there are potential conflicts.
 */
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


/**
 * Detects conflicts between a local branch and a remote branch.
 * 
 * @param localBranch - The name of the local branch.
 * @param remoteBranch - The name of the remote branch.
 * @param wsFolderPath - The path of the workspace folder.
 * @returns An array of files that have potential conflicts.
 */
export function detectLocalRemoteConflicts(localBranch: string, remoteBranch: string, wsFolderPath: string): string[] {
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

/**
 * Detects potential conflicts between two branches using a diff-based approach.
 * 
 * @param base - The base commit to compare against.
 * @param currentBranch - The name of the current branch.
 * @param targetBranch - The name of the target branch.
 * @param wsFolderPath - The path of the workspace folder.
 * @returns An array of files that have potential conflicts.
 */
export function detectPotentialConflicts(base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): string[] {
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

/**
 * Enhanced function to detect conflict files between branches.
 * This function detects files that have potential conflicts between two branches.
 * 
 * @param base - The base commit to compare against.
 * @param currentBranch - The name of the current branch.
 * @param targetBranch - The name of the target branch.
 * @param wsFolderPath - The path of the workspace folder.
 * @returns An array of files that have potential conflicts.
 */
export function detectConflictFiles(base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): string[] {
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

/**
 * Enhanced function to detect real conflicts between branches.
 * This function checks if a file has real conflicts between the current branch and the target branch.
 * 
 * @param filePath - The path of the file to check for conflicts.
 * @param base - The base commit to compare against.
 * @param currentBranch - The name of the current branch.
 * @param targetBranch - The name of the target branch.
 * @param wsFolderPath - The path of the workspace folder.
 * @returns A boolean indicating whether the file has real conflicts.
 */
export function hasRealConflict(filePath: string, base: string, currentBranch: string, targetBranch: string, wsFolderPath: string): boolean {
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