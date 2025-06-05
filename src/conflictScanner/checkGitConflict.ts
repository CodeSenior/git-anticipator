import { exec } from "child_process";

/**
 * Vérifie s'il y a des conflits Git dans le dépôt donné.
 */
export function checkGitConflicts(repoPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		exec('git diff --name-only --diff-filter=U', { cwd: repoPath }, (err, stdout) => {
			if (err) {
				console.error('Erreur lors de la vérification des conflits Git :', err);
				resolve(false);
			} else {
				const hasConflicts = stdout.trim().length > 0;
				resolve(hasConflicts);
			}
		});
	});
}