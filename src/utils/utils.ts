import path from "path";
import { executeGitCommand } from "../command/command";
import { exec } from 'child_process';
import * as util from 'util';
import { promisify } from "util";
import * as vscode from 'vscode';
import fs from 'fs';
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


/**
 * Checks if the current workspace is a Git repository.
 * @returns {Promise<boolean>} - Returns true if the workspace is a Git repository, false otherwise.
 */
export async function isGitRepo(): Promise<boolean> {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        const git = gitExtension?.getAPI(1);

        if (git && git.repositories.length > 0) {
            return true;
        }

        // Fallback vers la méthode manuelle
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        const execAsync = promisify(exec);
        await execAsync('git rev-parse --is-inside-work-tree', {
            cwd: workspaceFolder.uri.fsPath
        });
        return true;
    } catch {
        return false;
    }
}


/**
 * Checks if a directory is a Git repository.
 * @param {string} folderPath - The path of the directory to check.
 * @returns {boolean} - Returns true if the directory is a Git repository, false otherwise.
 */
export function isGitRepository(folderPath: string): boolean {
    try {
        return fs.existsSync(path.join(folderPath, '.git'));
    } catch {
        return false;
    }
}

/**
 * Checks if a given file path is a directory.
 * @param {string} filePath - The path of the file to check.
 * @param {string} wsFolderPath - The path of the workspace folder.
 * @returns {boolean} - Returns true if the file path is a directory, false otherwise.
 */
export function isDirectory(filePath: string, wsFolderPath: string): boolean {
    try {
      const fullPath = path.join(wsFolderPath, filePath);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    } catch (error) {
      return false;
    }
  }