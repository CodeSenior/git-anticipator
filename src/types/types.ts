import * as vscode from 'vscode';
import * as path from 'path';

export const conflictDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    overviewRulerColor: 'red',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    gutterIconPath: vscode.Uri.file(path.join(__dirname, 'icons', 'conflict.svg')),
    gutterIconSize: 'contain'
});

export let conflictedFilesSet = new Set<string>();