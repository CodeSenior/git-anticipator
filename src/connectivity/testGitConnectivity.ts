import { executeGitCommand } from "../command/command";
import { translate } from "../language";

// Fonction pour tester la connectivité Git
export function testGitConnectivity(wsFolderPath: string): boolean {
    console.log(translate('Testing Git connectivity...'));
    
    // Test 1: Vérifier si on peut accéder aux remotes
    const remotes = executeGitCommand('git remote -v', wsFolderPath);
    if (!remotes) {
      console.log(translate('No remotes configured'));
      return true; // Pas de remote = pas besoin de connectivité
    }
    
    console.log(`Configured remotes: ${remotes}`);
    
    // Test 2: Essayer de faire un ls-remote (lecture seule)
    const lsRemote = executeGitCommand('git ls-remote --heads origin', wsFolderPath);
    if (lsRemote === null) {
      console.log(translate('Cannot connect to remote repository'));
      return false;
    }
    
    console.log(translate('Git connectivity test passed'));
    return true;
  }