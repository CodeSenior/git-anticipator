import * as vscode from 'vscode';
import * as path from 'path';

export class ConflictFilesProvider implements vscode.TreeDataProvider<ConflictFileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConflictFileItem | undefined | null | void> = new vscode.EventEmitter<ConflictFileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConflictFileItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private conflictedFiles: string[] = [];
  private targetBranch: string;

  constructor(targetBranch: string) {
    this.targetBranch = targetBranch;
  }

  refresh(filePath?: string): void {
    console.log('Refreshing tree view');
    this._onDidChangeTreeData.fire();
  }

  updateConflictedFiles(files: string[]): void {
    const hadConflicts = this.conflictedFiles.length > 0;
    this.conflictedFiles = files;
    this.refresh();
  
    if (files.length > 0 && !hadConflicts) {
      vscode.window.showWarningMessage(`🚨 ${files.length} conflict(s) detected with the branch ${this.targetBranch}.`);
    }
  }

  setTargetBranch(branch: string): void {
    this.targetBranch = branch;
    this.refresh();
  }

  getTargetBranch(): string {
    return this.targetBranch;
  }

  getTreeItem(element: ConflictFileItem): vscode.TreeItem {
    return element;
  }

  getConflictedFilesCount(): number {
    return this.conflictedFiles.length;
  }

  getChildren(element?: ConflictFileItem): Thenable<ConflictFileItem[]> {
    if (!element) {
      // Racine - afficher les informations de branche et les fichiers
      const items: ConflictFileItem[] = [];
      
      // Ajouter l'information de la branche cible
      const branchInfo = new ConflictFileItem(
        `Target branch: ${this.targetBranch}`,
        vscode.TreeItemCollapsibleState.None,
        'branchInfo'
      );
      branchInfo.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'images', 'merge_8906964.png'));
      branchInfo.tooltip = `Conflicts detected compared to the branch: ${this.targetBranch}`;
      items.push(branchInfo);

      // Ajouter les fichiers en conflit
      if (this.conflictedFiles.length === 0) {
        const noConflicts = new ConflictFileItem(
          'No conflicts detected',
          vscode.TreeItemCollapsibleState.None,
          'noConflict'
        );
        noConflicts.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'images', 'check-mark_5290119.png'));
        items.push(noConflicts);
      } else {
        this.conflictedFiles.forEach(filePath => {
          const fileName = path.basename(filePath);
          const relativePath = vscode.workspace.asRelativePath(filePath);
          
          const fileItem = new ConflictFileItem(
            fileName,
            vscode.TreeItemCollapsibleState.None,
            'conflictFile'
          );
          fileItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
          fileItem.tooltip = `Conflict detected: ${relativePath}`;
          fileItem.resourceUri = vscode.Uri.file(filePath);
          fileItem.command = {
            command: 'gitConflictAnticipator.openFile',
            title: 'Open file',
            arguments: [vscode.Uri.file(filePath)]
          };
          
          items.push(fileItem);
        });
      }

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}

export class ConflictFileItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string
  ) {
    super(label, collapsibleState);
  }
}