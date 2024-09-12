import * as vscode from "vscode";
import GPT3Tokenizer from "gpt3-tokenizer";
import { CodeChunk } from "./parseProject";
import * as path from "path";
import * as fs from "fs";
import exp from "constants";


const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
let currentFilePath: string;
function getCurrentFileContent(): undefined | string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor found!");
        return undefined;
    }
    const document = editor.document;
    if (document.uri.scheme !== "file") {
        vscode.window.showErrorMessage("Active file is not a physical file.");
        return undefined;
    }

    const fileContent = document.getText();
    currentFilePath = document.fileName;
    return fileContent;
}

function buildQuery(currentFileContent: string): string {
    return currentFileContent;
}

function jaccard_similarity(list1: number[], list2: number[]): number {
    const set1 = new Set<number>(list1);
    const set2 = new Set<number>(list2);
    const union = new Set<number>([...set1, ...set2]);
    const intersection = new Set<number>([...set1].filter(x => set2.has(x)));
    return intersection.size / union.size;
}

function retrieve(context: vscode.ExtensionContext, topK: number) {
    const fileContent = getCurrentFileContent();
    if (!fileContent) throw Error("Can not retrieve relevant context");
    const query = buildQuery(fileContent);
    const query_embedding = tokenizer.encode(query).bpe;
    const cacheName = 'zerodev';
    const repoCodeChunks = context.workspaceState.get<{ [key: string]: any }>(cacheName);
    if (!repoCodeChunks) return new Array<[CodeChunk, number]>();
    let relevantCodeChunks = new Array<[CodeChunk, number]>();
    for (let i = 0; i < repoCodeChunks.length; i++) {
        const simScore = jaccard_similarity(query_embedding, repoCodeChunks[i].embedding);
        relevantCodeChunks.push([repoCodeChunks[i], simScore]);
    }
    relevantCodeChunks.sort((a, b) => b[1] - a[1]);
    console.log(relevantCodeChunks.slice(0, topK));
    return relevantCodeChunks.slice(0, topK);
}

async function makeAnExtendedBlock(retrievedCodeChunk: [CodeChunk, number], language: string, commentToken: string, sep: string): Promise<[string, number]> {
    const [codeChunk, simScore] = retrievedCodeChunk;
    const metadata = codeChunk.metadata;
    const workspacePath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
    if (!workspacePath) throw Error("Can not get workspace path");
    const relativePath = path.relative(workspacePath, metadata.filePath);[]
    const pathComment = `${commentToken} the below code fragment can be found in: ${relativePath}`;
    const fileContent = fs.readFileSync(metadata.filePath, "utf-8");
    const codeLines = fileContent.split('\n');
    const newEndLineNo = Math.min(metadata.endLineNo + Math.floor(metadata.windowSize / metadata.sliceSize), codeLines.length);
    const newStartLineNo = Math.max(0, newEndLineNo - metadata.windowSize);
    const contentLines = codeLines.slice(newStartLineNo, newEndLineNo);
    const contentLinesComment = contentLines.map((line) => `${commentToken} ${line}`);
    const blockString = pathComment + '\n' + sep + '\n' + contentLinesComment.join('\n') + '\n' + sep + "\n\n";
    const tokenLen = tokenizer.encode(blockString).bpe.length;
    return [blockString, tokenLen];
}
export async function buildRepoLevelContext(context: vscode.ExtensionContext, topK: number, contextLength: number): Promise<string> {
    const relevantCodeChunks = retrieve(context, topK);
    let language: string;
    if (currentFilePath.endsWith(".py")) language = "Python";
    else if (currentFilePath.endsWith(".cpp")) language = "C++";
    else if (currentFilePath.endsWith(".java")) language = "Java"
    else if (currentFilePath.endsWith(".php")) language = "PHP";
    else if (currentFilePath.endsWith(".ts")) language = "Typescript";
    else if (currentFilePath.endsWith(".cs")) language = "C#";
    else if (currentFilePath.endsWith(".sh")) language = "Shell";
    else if (currentFilePath.endsWith(".js")) language = "JavaScript";
    else throw Error("Not implemented");
    const commentToken = (language == "Python" || language == "Shell") ? "#" : "//";
    const sep = `${commentToken} --------------------------------------------------`
    let prependContext = `${commentToken} Here are some relevant code fragments from other files of the repo:` + '\n' + sep + '\n';
    let currentTokenLen = 20;
    let prependBlocks = [];
    for (const retrievedCodeChunk of relevantCodeChunks) {
        const [blockString, tokenLen] = await makeAnExtendedBlock(retrievedCodeChunk, language, commentToken, sep);
        if (currentTokenLen + tokenLen <= contextLength) {
            prependBlocks.push(blockString);
            currentTokenLen += tokenLen;
            console.log(currentTokenLen);
        } else {
            continue;
        }
    }
    prependContext += prependBlocks.reverse().join('\n');
    console.log(prependContext);
    return prependContext;
}

export function buildInFileContext(): string {
    const context = getCurrentFileContent();
    if (!context) throw Error("Can not retrieve relevant context");
    return context;
}



