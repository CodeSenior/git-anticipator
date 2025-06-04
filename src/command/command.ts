import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function executeGitCommand(command: string, cwd: string): string | null {
  try {
    // Vérifier que le répertoire existe
    if (!fs.existsSync(cwd)) {
      console.error(`Working directory does not exist: ${cwd}`);
      return null;
    }
    
    // Vérifier que c'est un dépôt Git
    if (!fs.existsSync(path.join(cwd, '.git'))) {
      console.error(`Not a git repository: ${cwd}`);
      return null;
    }
    
    console.log(`Executing: ${command} in ${cwd}`);
    
    const result = execSync(command, { 
      cwd, 
      encoding: 'utf8',
      timeout: 30000, // Augmenter le timeout à 30 secondes
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true // Cacher la fenêtre de commande sur Windows
    }).toString().trim();
    
    console.log(`Success: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
    return result;
  } catch (error: any) {
    console.error(`Git command failed: ${command}`);
    console.error(`Working directory: ${cwd}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error code: ${error.status}`);
    
    if (error.stderr) {
      const stderr = error.stderr.toString();
      console.error(`Stderr: ${stderr}`);
      
      // Fournir des conseils spécifiques selon l'erreur
      if (stderr.includes('not a git repository')) {
        console.error('Advice: Make sure you are in a git repository');
      } else if (stderr.includes('bad revision')) {
        console.error('Advice: Check that the branch/commit exists');
      } else if (stderr.includes('ambiguous argument')) {
        console.error('Advice: The branch reference might be ambiguous');
      } else if (stderr.includes('unknown revision')) {
        console.error('Advice: The specified revision does not exist');
      }
    }
    
    if (error.stdout) {
      console.error(`Stdout: ${error.stdout.toString()}`);
    }
    
    return null;
  }
}

