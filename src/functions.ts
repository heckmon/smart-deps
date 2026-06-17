import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as vscode from 'vscode';
import * as path from "path";
import { exec } from "child_process";
import { Builder, parseStringPromise } from "xml2js";

function detectFramework(dirPath: string): Frameworks {
  const exists = (file: string) =>
    fsSync.existsSync(path.join(dirPath, file));

  if (exists("package.json")){
    return Frameworks.NPM;
  };

  if (exists("deno.json") || exists("deno.jsonc")){
    return Frameworks.DENO;
  }

  if (exists("bun.lockb")){
    return Frameworks.BUN;
  }

  if (exists("pubspec.yaml")) {
    return Frameworks.PUB;
  }

  if (exists("requirements.txt") || exists("pyproject.toml")) {
    return Frameworks.PYPI;
  }

  if (exists("Cargo.toml")) {
    return Frameworks.CARGO;
  }

  if (exists("pom.xml")) {
    return Frameworks.MAVEN;
  }

  if (exists("build.gradle") || exists("build.gradle.kts")){
    return Frameworks.GRADLE;
  }

  if (fsSync.readdirSync(dirPath).some(f => f.endsWith(".csproj"))){
    return Frameworks.NUGET;
  }

  if (exists("composer.json")) {
    return Frameworks.COMPOSER;
  }

  if (exists("Gemfile")) {
    return Frameworks.GEM;
  }

  if (exists("go.mod")) {
    return Frameworks.GO_MODULES;
  }

  if (exists("Package.swift")) {
    return Frameworks.SWIFT_PM;
  }

  if (exists("conanfile.txt")) {
    return Frameworks.CONAN;
  }

  if (exists("vcpkg.json")) {
    return Frameworks.VCPKG;
  }

  if (fsSync.readdirSync(dirPath).some((f:string) => f.endsWith(".rockspec"))) {
    return Frameworks.LUAROCKS;
  }

  if (exists("mix.exs")) {
    return Frameworks.HEX;
  }

  return Frameworks.UNKNOWN;
}

async function fetchPackageNamesFromKeyword(
  framework: Frameworks,
  keyword: string,
): Promise<Package[]> {

  try {
    switch (framework) {

      case Frameworks.NPM: {
        const response = await fetch(
          `https://registry.npmjs.org/-/v1/search?text=${keyword}`
        );

        const json = await response.json();

        return json.objects.map(
          (pkg: any) =>
            new Package(
              pkg.package.name,
              pkg.package.links.npm,
              pkg.package.version
            )
        );
      }

      case Frameworks.PUB: {
        const response = await fetch(
          `https://pub.dev/api/search?q=${keyword}`
        );

        const json = await response.json();

        return json.packages.map(
          (pkg: any) =>
            new Package(
              pkg.package,
              `https://pub.dev/packages/${pkg.package}`,
              "unknown"
            )
        );
      }

      case Frameworks.CARGO: {
        const response = await fetch(
          `https://crates.io/api/v1/crates?q=${keyword}`
        );

        const json = await response.json();

        return json.crates.map(
          (pkg: any) =>
            new Package(
              pkg.name,
              `https://crates.io/crates/${pkg.name}`,
              pkg.max_version
            )
        );
      }

      case Frameworks.NUGET: {
        const response = await fetch(
          `https://azuresearch-usnc.nuget.org/query?q=${keyword}`
        );

        const json = await response.json();

        return json.data.map(
          (pkg: any) =>
            new Package(
              pkg.id,
              `https://www.nuget.org/packages/${pkg.id}`,
              pkg.version
            )
        );
      }

      case Frameworks.GEM: {
        const response = await fetch(
          `https://rubygems.org/api/v1/search.json?query=${keyword}`
        );

        const json = await response.json();

        return json.map(
          (pkg: any) =>
            new Package(
              pkg.name,
              `https://rubygems.org/gems/${pkg.name}`,
              pkg.version
            )
        );
      }

      case Frameworks.COMPOSER: {
        const response = await fetch(
          `https://packagist.org/search.json?q=${keyword}`
        );

        const json = await response.json();

        return json.results.map(
          (pkg: any) =>
            new Package(
              pkg.name,
              pkg.url,
              "unknown"
            )
        );
      }

      case Frameworks.PYPI: {
        return [];
      }

      case Frameworks.GO_MODULES: {
        const response = await fetch(
          `https://proxy.golang.org/${keyword}/@latest`
        );

        const json = await response.json();

        return [
          new Package(
            keyword,
            `https://pkg.go.dev/${keyword}`,
            json.Version
          )
        ];
      }

      default:
        return [];
    }

  } catch (error) {
    console.error(error);
    return [];
  }
}

async function runInstallCommand(
    command: string,
    cwd: string,
    packageName: string
): Promise<void> {

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${packageName}`,
            cancellable: false
        },
        () => {
            return new Promise((resolve, reject) => {

                exec(
                    command,
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

            });
        }
    );
}

async function addDependency(
    framework: Frameworks,
    pkg: Package,
    projectPath: string
): Promise<void> {

    switch (framework) {

        case Frameworks.NPM:
            runInstallCommand(
                `npm install ${pkg.name}`,
                projectPath,
                pkg.name
            );
            exec;
            break;


        case Frameworks.DENO:
            runInstallCommand(
                `deno add ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.BUN:
            runInstallCommand(
                `bun add ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.PUB:
            runInstallCommand(
                `flutter pub add ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.PYPI:
            runInstallCommand(
                `pip install ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.CARGO:
            runInstallCommand(
                `cargo add ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.MAVEN: {
            const pom = path.join(projectPath, "pom.xml");

            const content = await fs.readFile(pom, "utf8");

            const parsed = await parseStringPromise(content);

            if (!parsed.project.dependencies) {
                parsed.project.dependencies = [
                    { dependency: [] }
                ];
            }

            const parts =
                pkg.name.split(":");

            parsed.project.dependencies[0]
                .dependency.push({
                    groupId: [parts[0]],
                    artifactId: [parts[1]],
                    version: [pkg.version]
                });

            const builder = new Builder();

            await fs.writeFile(pom, builder.buildObject(parsed));

            break;
        }


        case Frameworks.GRADLE: {
            const gradle =
                path.join(
                    projectPath,
                    "build.gradle"
                );

            let content = await fs.readFile(gradle, "utf8");

            content += `\ndependencies {\n implementation '${pkg.name}:${pkg.version}'\n}\n`;

            await fs.writeFile(gradle, content);

            break;
        }


        case Frameworks.NUGET:
            runInstallCommand(
                `dotnet add package ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.COMPOSER:
            runInstallCommand(
                `composer require ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.GEM:
            runInstallCommand(
                `bundle add ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.GO_MODULES:
            runInstallCommand(
                `go get ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.SWIFT_PM:
            runInstallCommand(
                `swift package add-dependency ${pkg.url}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.CONAN:
            runInstallCommand(
                `conan install ${pkg.name}/${pkg.version}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.VCPKG:
            runInstallCommand(
                `vcpkg install ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.LUAROCKS:
            runInstallCommand(
                `luarocks install ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        case Frameworks.HEX:
            runInstallCommand(
                `mix deps.get ${pkg.name}`,
                projectPath,
                pkg.name
            );
            break;


        default:
            vscode.window.showErrorMessage(
                "Unsupported framework"
            );
    }
}

enum Frameworks {
  NPM,
  DENO,
  BUN,
  PUB,
  PYPI,
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

export { detectFramework, fetchPackageNamesFromKeyword, Frameworks, Package };