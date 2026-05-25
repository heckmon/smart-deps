import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.commands.registerCommand("smart-deps.addDependency", () => {
			
		}),

		vscode.commands.registerCommand("smart-deps.selectFramework", () => {
			
		})
	);
}

export function deactivate() {}
