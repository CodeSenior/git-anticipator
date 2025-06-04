import { executeGitCommand } from "../command/command";
import { exec } from 'child_process';
import * as util from 'util';
const execAsync = util.promisify(exec);

/**
 * Function to normalize branch names with local/remote support
 * @param branchName - The name of the branch to normalize
 * @param wsFolderPath - The path of the workspace folder
 * @returns - The normalized branch name or null if not found
 */
export function normalizeBranchName(branchName: string, wsFolderPath: string): string | null {
  console.log(`Normalizing branch name: ${branchName}`);
  
  // Check if the branch exists locally
  const localBranches = executeGitCommand('git branch --format="%(refname:short)"', wsFolderPath);
  if (localBranches) {
    const branches = localBranches.split('\n').map(b => b.trim().replace(/^\*\s*/, ''));
    if (branches.includes(branchName)) {
      console.log(`Found local branch: ${branchName}`);
      return branchName;
    }
  }
  
  // Check if the branch exists as a remote
  const remoteBranches = executeGitCommand('git branch -r --format="%(refname:short)"', wsFolderPath);
  if (remoteBranches) {
    const branches = remoteBranches.split('\n').map(b => b.trim());
    
    // Look for origin/branchName
    const originBranch = `origin/${branchName}`;
    if (branches.includes(originBranch)) {
      console.log(`Found remote branch: ${originBranch}`);
      return originBranch;
    }
    
    // Look for other remotes
    const matchingBranch = branches.find(b => b.endsWith(`/${branchName}`));
    if (matchingBranch) {
      console.log(`Found remote branch: ${matchingBranch}`);
      return matchingBranch;
    }
  }
  
  console.log(`Branch not found: ${branchName}`);
  return null;
}


export async function isGitRepo(): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}