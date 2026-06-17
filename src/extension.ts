import * as vscode from 'vscode';
import { detectFramework, fetchPackageNamesFromKeyword, Frameworks, Package } from './functions';

export async function activate(context: vscode.ExtensionContext) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const framework = !workspaceFolder ? Frameworks.UNKNOWN : detectFramework(workspaceFolder.uri.fsPath);
	const quickPick = vscode.window.createQuickPick();
	quickPick.matchOnDetail = true;
	quickPick.placeholder = "Search package";
	quickPick.onDidChangeValue(async (value) => {
		if (!value) {
			return;
		}

		const packages = await fetchPackageNamesFromKeyword(framework, value);

		quickPick.items = packages.map(pkg => ({
			label: pkg.name,
			description: pkg.version === "unkno	wn" ? "" : pkg.version,
			detail: pkg.url
		}));
	});

	quickPick.onDidAccept((val) => {
		
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("smart-deps.addDependency", async () => {
			quickPick.show();
		}),
	);
}

export function deactivate() {}
