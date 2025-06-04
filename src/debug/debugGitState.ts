import { executeGitCommand } from "../command/command";
import { translate } from "../language";
import * as fs from 'fs';
import * as path from 'path';

export function debugGitState(wsFolderPath: string): void {
  console.log(translate('=== DEBUG: Git Repository State ==='));
  
  // Vérifications de base
  console.log(`Working directory: ${wsFolderPath}`);
  console.log(`Directory exists: ${fs.existsSync(wsFolderPath)}`);
  console.log(`Is git repo: ${fs.existsSync(path.join(wsFolderPath, '.git'))}`);
  
  // État du dépôt
  const status = executeGitCommand('git status --porcelain', wsFolderPath);
  console.log(`Git status: ${status || 'FAILED'}`);
  
  const currentBranch = executeGitCommand('git rev-parse --abbrev-ref HEAD', wsFolderPath);
  console.log(`Current branch: ${currentBranch || 'FAILED'}`);
  
  const currentCommit = executeGitCommand('git rev-parse HEAD', wsFolderPath);  
  console.log(`Current commit: ${currentCommit || 'FAILED'}`);
  
  // Branches disponibles
  const localBranches = executeGitCommand('git branch', wsFolderPath);
  console.log(`Local branches: ${localBranches || 'FAILED'}`);
  
  const remoteBranches = executeGitCommand('git branch -r', wsFolderPath);
  console.log(`Remote branches: ${remoteBranches || 'FAILED'}`);
  
  // Configuration
  const remoteOrigin = executeGitCommand('git remote get-url origin', wsFolderPath);
  console.log(`Remote origin: ${remoteOrigin || 'FAILED'}`);
  
  console.log(translate('=== END DEBUG ==='));
}
