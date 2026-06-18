import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as vscode from 'vscode';
import * as path from "path";
import * as cheerio from "cheerio";
import { exec } from "child_process";
import { Builder, parseStringPromise } from "xml2js";

enum Frameworks {
  NPM,
  DENO,
  BUN,
  PUB,
  PYPI,
  PIPENV,
  POETRY,
  UV,
  CARGO,
  MAVEN,
  GRADLE,
  NUGET,
  COMPOSER,
  GEM,
  GO_MODULES,
  SWIFT_PM,
  CONAN,
  VCPKG,
  LUAROCKS,
  HEX,
  UNKNOWN
}

class Package {
  name: string;
  url: string;
  version: string;

  constructor(name: string, url: string, version: string) {
    this.name = name;
    this.url = url;
    this.version = version;
  }
}

interface PackageQuickPickItem extends vscode.QuickPickItem {
  pkg: Package;
}

function readFileSafe(filePath: string): string {
  try {
    return fsSync.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function findVenvDir(projectPath: string): string | null {
  for (const candidate of [".venv", "venv"]) {
    const full = path.join(projectPath, candidate);
    if (fsSync.existsSync(full) && fsSync.statSync(full).isDirectory()) {
      return full;
    }
  }
  return null;
}

function findPythonExecutable(projectPath: string): string | null {
  const venvDir = findVenvDir(projectPath);
  if (!venvDir) {return null;}

  const pythonPath = process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  return fsSync.existsSync(pythonPath) ? pythonPath : null;
}

function readPyvenvCfg(venvDir: string): Record<string, string> {
  const cfgPath = path.join(venvDir, "pyvenv.cfg");
  const content = readFileSafe(cfgPath);
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) {continue;}
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim().toLowerCase();
    result[key] = val;
  }
  return result;
}

function detectFramework(dirPath: string): Frameworks {
  const exists = (file: string) => fsSync.existsSync(path.join(dirPath, file));

  let files: string[] = [];
  try {
    files = fsSync.readdirSync(dirPath);
  } catch {
    return Frameworks.UNKNOWN;
  }

  const scores = new Map<Frameworks, number>();
  const addScore = (framework: Frameworks, score: number) => {
    scores.set(framework, (scores.get(framework) || 0) + score);
  };

  if (exists("package.json")){ addScore(Frameworks.NPM, 100); }
  if (exists("package-lock.json")) { addScore(Frameworks.NPM, 80);  }
  if (exists("yarn.lock")){ addScore(Frameworks.NPM, 60);  }
  if (exists("pnpm-lock.yaml")){ addScore(Frameworks.NPM, 60);  }

  if (exists("deno.json")){ addScore(Frameworks.DENO, 100); }
  if (exists("deno.jsonc")){ addScore(Frameworks.DENO, 100); }
  if (exists("deno.lock")){ addScore(Frameworks.DENO, 80);  }

  if (exists("bun.lockb")){ addScore(Frameworks.BUN, 100); }
  if (exists("bunfig.toml")){ addScore(Frameworks.BUN, 80);  }

  if (exists("pubspec.yaml")){ addScore(Frameworks.PUB, 100); }
  if (exists("pubspec.lock")){ addScore(Frameworks.PUB, 80);  }
  if (files.some(f => f.endsWith(".dart"))){ addScore(Frameworks.PUB, 20);  }

  if (exists("requirements.txt")){ addScore(Frameworks.PYPI, 100); }
  if (exists("setup.py")){ addScore(Frameworks.PYPI, 80);  }
  if (exists("setup.cfg")){ addScore(Frameworks.PYPI, 60);  }
  if (exists("MANIFEST.in")){ addScore(Frameworks.PYPI, 30);  }
  if (files.some(f => f.endsWith(".py"))) { addScore(Frameworks.PYPI, 10); }

  if (exists("Pipfile")){ addScore(Frameworks.PIPENV, 100); }
  if (exists("Pipfile.lock")){ addScore(Frameworks.PIPENV, 80);  }

  if (exists("poetry.lock")){ addScore(Frameworks.POETRY, 100); }
  if (exists("uv.lock")){ addScore(Frameworks.UV, 100);     }

  if (exists("pyproject.toml")) {
    const content = readFileSafe(path.join(dirPath, "pyproject.toml"));
    if (content.includes("[tool.poetry]")){ addScore(Frameworks.POETRY, 90); }
    if (content.includes("[tool.uv]")){ addScore(Frameworks.UV, 90);     }
    if (
      content.includes("[build-system]") &&
      !content.includes("[tool.poetry]") &&
      !content.includes("[tool.uv]")
    ) {
      addScore(Frameworks.PYPI, 60);
    }
  }

  const venvDir = findVenvDir(dirPath);
  if (venvDir) {
    const cfg = readPyvenvCfg(venvDir);

    if (cfg["virtualenv"] || cfg["prompt"]?.includes("pipenv")) {
      addScore(Frameworks.PIPENV, 40);
    }

    const cfgValues = Object.values(cfg).join(" ");
    if (cfgValues.includes("uv")) {
      addScore(Frameworks.UV, 40);
    }

    addScore(Frameworks.PYPI, 20);
  }

  if (exists("Cargo.toml")){ addScore(Frameworks.CARGO, 100); }
  if (exists("Cargo.lock")){ addScore(Frameworks.CARGO, 80);  }
  if (files.some(f => f.endsWith(".rs"))){ addScore(Frameworks.CARGO, 20);  }

  if (exists("pom.xml")){ addScore(Frameworks.MAVEN, 100); }
  
  if (exists("build.gradle")){ addScore(Frameworks.GRADLE, 100); }
  if (exists("build.gradle.kts")){ addScore(Frameworks.GRADLE, 100); }
  if (exists("settings.gradle")){ addScore(Frameworks.GRADLE, 60);  }
  if (exists("settings.gradle.kts")){ addScore(Frameworks.GRADLE, 60);  }
  if (exists("gradlew")){ addScore(Frameworks.GRADLE, 40);  }

  if (files.some(f => f.endsWith(".csproj"))){ addScore(Frameworks.NUGET, 100); }
  if (files.some(f => f.endsWith(".sln"))){ addScore(Frameworks.NUGET, 80);  }
  if (files.some(f => f.endsWith(".cs"))){ addScore(Frameworks.NUGET, 20);  }

  if (exists("composer.json")){ addScore(Frameworks.COMPOSER, 100); }
  if (exists("composer.lock")){ addScore(Frameworks.COMPOSER, 80);  }

  if (exists("Gemfile")){ addScore(Frameworks.GEM, 100); }
  if (exists("Gemfile.lock")){ addScore(Frameworks.GEM, 80);  }

  if (exists("go.mod")){ addScore(Frameworks.GO_MODULES, 100); }
  if (exists("go.sum")){ addScore(Frameworks.GO_MODULES, 80);  }
  if (files.some(f => f.endsWith(".go"))){ addScore(Frameworks.GO_MODULES, 20);  }

  if (exists("Package.swift")){ addScore(Frameworks.SWIFT_PM, 100); }
  if (exists("Package.resolved")){ addScore(Frameworks.SWIFT_PM, 80);  }

  if (exists("conanfile.txt")){ addScore(Frameworks.CONAN, 100); }
  if (exists("conanfile.py")){ addScore(Frameworks.CONAN, 100); }

  if (exists("vcpkg.json")){ addScore(Frameworks.VCPKG, 100); }
  if (exists("vcpkg-configuration.json")){ addScore(Frameworks.VCPKG, 80);  }

  if (files.some(f => f.endsWith(".rockspec"))){ addScore(Frameworks.LUAROCKS, 100); }

  if (exists("mix.exs")){ addScore(Frameworks.HEX, 100); }
  if (exists("mix.lock")){ addScore(Frameworks.HEX, 80);  }

  let best = Frameworks.UNKNOWN;
  let max = 0;

  for (const [framework, score] of scores.entries()) {
    if (score > max) {
      max = score;
      best = framework;
    }
  }

  return best;
}

function getFramework(context: vscode.ExtensionContext, workspacePath: string): Frameworks {
  const override = context.workspaceState.get<Frameworks>("frameworkOverride");
  if (override !== undefined) {
    return override;
  }
  return detectFramework(workspacePath);
}

async function selectFramework(context: vscode.ExtensionContext, workspacePath: string) {
  const detected = detectFramework(workspacePath);
  const frameworks = Object.values(Frameworks).filter(v => typeof v === "number") as Frameworks[];
  const items = frameworks.map(f => ({
    label: Frameworks[f],
    description: f === detected ? "Auto-detected" : "",
    value: f
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select package manager"
  });

  if (!selected) {
    return;
  }

  await context.workspaceState.update("frameworkOverride", selected.value);
  vscode.window.showInformationMessage(`Framework set to ${selected.label}`);
}

async function resetFramework(context: vscode.ExtensionContext) {
  await context.workspaceState.update("frameworkOverride", undefined);
  vscode.window.showInformationMessage("Framework auto-detection restored");
}

async function fetchPackageNamesFromKeyword(framework: Frameworks, keyword: string): Promise<Package[]> {
  try {
    switch (framework) {
      case Frameworks.NPM: {
        const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(keyword)}`);
        const json = await response.json();
        return json.objects.map((pkg: any) =>
          new Package(pkg.package.name, pkg.package.links.npm, pkg.package.version)
        );
      }

      case Frameworks.PUB: {
        const response = await fetch(`https://pub.dev/api/search?q=${encodeURIComponent(keyword)}`);
        const json = await response.json();
        return json.packages.map((pkg: any) =>
          new Package(pkg.package, `https://pub.dev/packages/${pkg.package}`, "unknown")
        );
      }

      case Frameworks.CARGO: {
        const response = await fetch(`https://crates.io/api/v1/crates?q=${encodeURIComponent(keyword)}`, {
          headers: {
            "User-Agent": "smart-deps-vscode-extension (github.com/heckmon/smart-deps)"
          }
        });
        const json = await response.json();
        return json.crates.map((pkg: any) =>
          new Package(pkg.name, `https://crates.io/crates/${pkg.name}`, pkg.max_version)
        );
      }

      case Frameworks.NUGET: {
        const response = await fetch(`https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(keyword)}`);
        const json = await response.json();
        return json.data.map((pkg: any) =>
          new Package(pkg.id, `https://www.nuget.org/packages/${pkg.id}`, pkg.version)
        );
      }

      case Frameworks.GEM: {
        const response = await fetch(`https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(keyword)}`);
        const json = await response.json();
        return json.map((pkg: any) =>
          new Package(pkg.name, `https://rubygems.org/gems/${pkg.name}`, pkg.version)
        );
      }

      case Frameworks.COMPOSER: {
        const response = await fetch(`https://packagist.org/search.json?q=${encodeURIComponent(keyword)}`);
        const json = await response.json();
        return json.results.map((pkg: any) =>
          new Package(pkg.name, pkg.url, "unknown")
        );
      }

      case Frameworks.PYPI:
      case Frameworks.PIPENV:
      case Frameworks.POETRY:
      case Frameworks.UV:
        return await searchPyPi(keyword);

      case Frameworks.GO_MODULES: {
        const response = await fetch(`https://proxy.golang.org/${keyword}/@latest`);
        const json = await response.json();
        return [new Package(keyword, `https://pkg.go.dev/${keyword}`, json.Version)];
      }

      default:
        return [];
    }
  } catch (error) {
    console.error(error);
    return [];
  }
}

function buildShellCommand(command: string) {
  if (process.platform === "win32") {
    return {
      shell: "powershell",
      command: `-Command "${command}"`
    };
  }
  return {
    shell: process.env.SHELL || "/bin/bash",
    command: `-ic '${command}'`
  };
}

async function runInstallCommand(command: string, cwd: string, packageName: string): Promise<void> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${packageName}`,
      cancellable: false
    },
    () => new Promise((resolve, reject) => {
      const shell = buildShellCommand(command);
      exec(
        `${shell.shell} ${shell.command}`,
        { cwd },
        (error, stdout, stderr) => {
          if (error) {
            const reason = stderr || stdout || error.message;
            vscode.window.showErrorMessage(`Failed installing ${packageName}\n${reason}`);
            reject(error);
            return;
          }
          vscode.window.showInformationMessage(`${packageName} installed successfully`);
          resolve();
        }
      );
    })
  );
}

async function addDependency(framework: Frameworks, pkg: Package, projectPath: string): Promise<void> {
  switch (framework) {
    case Frameworks.NPM:
      await runInstallCommand(`npm install ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.DENO:
      await runInstallCommand(`deno add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.BUN:
      await runInstallCommand(`bun add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.PUB:
      await runInstallCommand(`flutter pub add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.PYPI: {
      const python = findPythonExecutable(projectPath);
      const installCmd = python
        ? `"${python}" -m pip install ${pkg.name}`
        : `pip install ${pkg.name}`;
      await runInstallCommand(installCmd, projectPath, pkg.name);
      break;
    }

    case Frameworks.PIPENV:
      await runInstallCommand(`pipenv install ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.POETRY:
      await runInstallCommand(`poetry add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.UV:
      await runInstallCommand(`uv add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.CARGO:
      await runInstallCommand(`cargo add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.MAVEN: {
      const pom = path.join(projectPath, "pom.xml");
      const content = await fs.readFile(pom, "utf8");
      const parsed = await parseStringPromise(content);

      if (!parsed.project.dependencies) {
        parsed.project.dependencies = [{ dependency: [] }];
      }

      const parts = pkg.name.split(":");
      parsed.project.dependencies[0].dependency.push({
        groupId:    [parts[0]],
        artifactId: [parts[1]],
        version:    [pkg.version]
      });

      const builder = new Builder();
      await fs.writeFile(pom, builder.buildObject(parsed));
      break;
    }

    case Frameworks.GRADLE: {
      const gradleFile = (exists: string) => fsSync.existsSync(path.join(projectPath, exists));
      const gradle = path.join(
        projectPath,
        gradleFile("build.gradle.kts") ? "build.gradle.kts" : "build.gradle"
      );

      let content = await fs.readFile(gradle, "utf8");

      if (content.includes("dependencies {")) {
        content = content.replace(
          /dependencies\s*\{/,
          `dependencies {\n    implementation '${pkg.name}:${pkg.version}'`
        );
      } else {
        content += `\ndependencies {\n    implementation '${pkg.name}:${pkg.version}'\n}\n`;
      }

      await fs.writeFile(gradle, content);
      break;
    }

    case Frameworks.NUGET:
      await runInstallCommand(`dotnet add package ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.COMPOSER:
      await runInstallCommand(`composer require ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.GEM:
      await runInstallCommand(`bundle add ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.GO_MODULES:
      await runInstallCommand(`go get ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.SWIFT_PM:
      await runInstallCommand(`swift package add-dependency ${pkg.url}`, projectPath, pkg.name);
      break;

    case Frameworks.CONAN:
      await runInstallCommand(`conan install --requires=${pkg.name}/${pkg.version}`, projectPath, pkg.name);
      break;

    case Frameworks.VCPKG:
      await runInstallCommand(`vcpkg install ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.LUAROCKS:
      await runInstallCommand(`luarocks install ${pkg.name}`, projectPath, pkg.name);
      break;

    case Frameworks.HEX:
      await runInstallCommand(`mix deps.get ${pkg.name}`, projectPath, pkg.name);
      break;

    default:
      vscode.window.showErrorMessage("Unsupported framework");
  }
}

let pypiIndexCache: string[] | null = null;
let pypiIndexFetchedAt = 0;
const PYPI_CACHE_TTL = 1000 * 60 * 30;

function rankPyPiResults(names: string[], keyword: string): string[] {
  const lower = keyword.toLowerCase();
  const exact: string[]  = [];
  const prefix: string[] = [];
  const contains: string[] = [];

  for (const name of names) {
    const n = name.toLowerCase();
    if (n === lower){ exact.push(name); }
    else if (n.startsWith(lower)){ prefix.push(name); }
    else{ contains.push(name); }
  }

  const byLength = (a: string, b: string) => a.length - b.length;
  return [
    ...exact.sort(byLength),
    ...prefix.sort(byLength),
    ...contains.sort(byLength)
  ];
}

async function searchPyPi(keyword: string): Promise<Package[]> {
  try {
    const now = Date.now();

    if (!pypiIndexCache || now - pypiIndexFetchedAt > PYPI_CACHE_TTL) {
      const response = await fetch("https://pypi.org/simple/", {
        headers: { "Accept": "application/vnd.pypi.simple.v1+json" }
      });
      if (!response.ok) {return [];}
      const json = await response.json();
      pypiIndexCache = (json.projects as { name: string }[]).map(p => p.name);
      pypiIndexFetchedAt = now;
    }

    const lower = keyword.toLowerCase();
    const matched = pypiIndexCache.filter(name => name.toLowerCase().includes(lower));
    const ranked  = rankPyPiResults(matched, keyword).slice(0, 20);

    const results = await Promise.allSettled(
      ranked.map(async name => {
        const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
        if (!r.ok) {return new Package(name, `https://pypi.org/project/${name}/`, "unknown");}
        const data = await r.json();
        return new Package(name, `https://pypi.org/project/${name}/`, data.info?.version ?? "unknown");
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<Package> => r.status === "fulfilled")
      .map(r => r.value);

  } catch (error) {
    console.error("PyPI search error:", error);
    return [];
  }
}

export {
  getFramework,
  fetchPackageNamesFromKeyword,
  addDependency,
  selectFramework,
  resetFramework,
  searchPyPi,
  Frameworks,
  Package,
  PackageQuickPickItem
};
