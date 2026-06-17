import * as vscode from 'vscode';
import { addDependency, detectFramework, fetchPackageNamesFromKeyword, Frameworks, Package, PackageQuickPickItem } from './functions';
import { exec } from 'child_process';

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

		quickPick.items = packages.map((pkg): PackageQuickPickItem => ({
			label: pkg.name,
			description: pkg.version === "unknown" ? "" : pkg.version,
			detail: pkg.url,
			pkg: pkg
		}));
	});

	quickPick.onDidAccept(async () => {
		quickPick.dispose();
		await addDependency(
			framework,
			(quickPick.selectedItems[0] as PackageQuickPickItem).pkg,
			workspaceFolder!.uri.fsPath
		);
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("smart-deps.addDependency", async () => {
			quickPick.show();
		}),
	);
}

export function deactivate() {}
