import * as vscode from "vscode";
import GPT3Tokenizer from "gpt3-tokenizer";
const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

interface FileMetadata {
    filePath: string;
    lastModified: Date;
    content: string;
}

export interface CodeChunk {
    code: string;
    metadata: {
        filePath: string;
        lastModified: Date;
        lastCached: Date;
        lineNo: number;
        startLineNo: number;
        endLineNo: number;
        windowSize: number;
        sliceSize: number;
    }
    embedding: any;
}

async function getAllFilesMetadata(): Promise<FileMetadata[]> {
    const filesMetadata: FileMetadata[] = [];

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return [];
    }
    const files = await vscode.workspace.findFiles("**/*");
    for (const file of files) {
        try {
            const fileStat = await vscode.workspace.fs.stat(file);
            const fileContent = await vscode.workspace.fs.readFile(file);
            if (file.fsPath.endsWith(".py")
                || file.fsPath.endsWith(".cpp")
                || file.fsPath.endsWith(".java")
                || file.fsPath.endsWith(".php")
                || file.fsPath.endsWith(".ts")
                || file.fsPath.endsWith(".cs")
                || file.fsPath.endsWith(".sh")
                || file.fsPath.endsWith(".js")
            ) {
                const metadata: FileMetadata = {
                    filePath: file.fsPath,
                    lastModified: new Date(fileStat.mtime),
                    content: Buffer.from(fileContent).toString("utf8")
                };

                filesMetadata.push(metadata);
            }
            if (file.fsPath.endsWith(".ipynb")) {
                const fileString = Buffer.from(fileContent).toString("utf8");
                const jsonContent = JSON.parse(fileString);
                const sourceCode: string[] = [];
                const cells = jsonContent.cells;
                for (const cell of cells) {
                    if (cell.cell_type == "code" && Array.isArray(cell.source)) {
                        sourceCode.push(cell.source.join(''));
                    }
                }
                const metadata: FileMetadata = {
                    filePath: file.fsPath,
                    lastModified: new Date(fileStat.mtime),
                    content: sourceCode.join('\n')
                };

                filesMetadata.push(metadata);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read file ${file.fsPath}: ${err.message}`);
        }
    }
    return filesMetadata;
}

class RepoWindowMaker {
    windowSize: number;
    sliceSize: number;
    sliceStep: number;
    sourceCodeFiles: FileMetadata[] = [];

    constructor(windowSize: number, sliceSize: number) {
        this.windowSize = windowSize;
        this.sliceSize = sliceSize;
        if (Math.floor(windowSize / sliceSize) == 0) {
            this.sliceStep = 1;
        } else {
            this.sliceStep = Math.floor(windowSize / sliceSize)
        }
    }
    async setSourceCodeFiles() {
        this.sourceCodeFiles = await getAllFilesMetadata();
    }

    buildWindowsForAFile(file: FileMetadata): CodeChunk[] {
        let codeChunks = [];
        const codeLines = file.content.split('\n');
        const deltaSize = Math.floor(this.windowSize / 2);
        for (let lineNo = 0; lineNo < codeLines.length; lineNo += this.sliceStep) {
            const startLineNo = Math.max(0, lineNo - deltaSize);
            const endLineNo = Math.min(codeLines.length, lineNo + this.windowSize - deltaSize);
            const windowLines = codeLines.slice(startLineNo, endLineNo);
            if (!windowLines) {
                continue;
            }
            const windowText = windowLines.join('\n');
            const encoded: { bpe: number[], text: string[] } = tokenizer.encode(windowText);
            codeChunks.push({
                code: windowText,
                metadata: {
                    filePath: file.filePath,
                    lastModified: file.lastModified,
                    lastCached: file.lastModified, // Temporary for simplicity
                    lineNo: lineNo,
                    startLineNo: startLineNo,
                    endLineNo: endLineNo,
                    windowSize: this.windowSize,
                    sliceSize: this.sliceSize
                },
                embedding: encoded.bpe
            });
        }
        return codeChunks;
    }

    async buildWindows(): Promise<CodeChunk[]> {
        await this.setSourceCodeFiles();
        let codeChunks: CodeChunk[] = [];
        for (const file of this.sourceCodeFiles) {
            const res = this.buildWindowsForAFile(file);
            codeChunks = codeChunks.concat(res);
        }
        console.log(codeChunks.length);
        return codeChunks;
    }
}

export async function saveMetadata(context: vscode.ExtensionContext) {
    const repoWindowMaker = new RepoWindowMaker(20, 2);
    const codeChunks = await repoWindowMaker.buildWindows();

    if (codeChunks.length === 0) {
        vscode.window.showInformationMessage("No files to save.");
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return;
    }
    const cacheName = "zerodev";
    try {
        await context.workspaceState.update(cacheName, codeChunks);
        console.log("Saved project");
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to save project file metadata`);
    }
}
