import * as vscode from 'vscode';
import {
	addDependency,
	getFramework,
	fetchPackageNamesFromKeyword,
	Frameworks,
	PackageQuickPickItem,
	selectFramework,
	resetFramework,
	searchPyPi
} from './functions';

export async function activate(context: vscode.ExtensionContext) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let timeout: NodeJS.Timeout;

	if (!workspaceFolder) {
        vscode.window.showErrorMessage("Smart Deps requires an open workspace");
        return;
    }
	
	const quickPick = vscode.window.createQuickPick();
	quickPick.matchOnDetail = true;
	quickPick.placeholder = "Search package";

	quickPick.onDidChangeValue(async (value) => {
		const framework = !workspaceFolder ? Frameworks.UNKNOWN : getFramework(context, workspaceFolder.uri.fsPath);
		if (!value) {
			return;
		}

		clearTimeout(timeout);

		timeout = setTimeout(async () => {
			const packages = await fetchPackageNamesFromKeyword(framework, value);
			quickPick.items = packages.map((pkg): PackageQuickPickItem => ({
				label: pkg.name,
				description: pkg.version === "unknown" ? "" : pkg.version,
				detail: pkg.url,
				pkg: pkg
			}));
		}, 400);

	});

	quickPick.onDidAccept(async () => {
		const framework = !workspaceFolder ? Frameworks.UNKNOWN : getFramework(context, workspaceFolder.uri.fsPath);
		quickPick.hide();
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

	context.subscriptions.push(
		vscode.commands.registerCommand("smart-deps.selectFramework", async () => {
			await selectFramework(context, workspaceFolder.uri.fsPath);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("smart-deps.resetFramework", async () => {
			await resetFramework(context);
		})
	);

	searchPyPi("").catch(() => {});
	
}

export function deactivate() {}