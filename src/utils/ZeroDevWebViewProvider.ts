import * as vscode from "vscode";
import { SnippetCode, FetchResult } from "../types";
import { fetchGeneration } from "./fetchAPI";
import assert from "assert";
import { API_GENERATE } from "../config";
import { buildRepoLevelContext, buildInFileContext } from "./retrieval";

export class ZeroDevWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "zerodev.chatView";
    private _view?: vscode.WebviewView;
    private readonly _api_gen = API_GENERATE;
    private readonly topK = 20;
    private readonly contextLength = 2048;
    private _prompt?: string;
    private _promptContext?: string;

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _extensionContext: vscode.ExtensionContext) { }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        webviewView.webview.html = this._getHtmlForWebView(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case "prompt":
                    console.log("ZeroDev has received message from webview");
                    this.search(data.value);
                    break;
            }
        });
    }
    private async buildRepoLevelPrompt(input: string): Promise<[string, string]> {
        let context = "";
        try {
            context = await buildRepoLevelContext(this._extensionContext, this.topK, this.contextLength);
        } catch (err) {
            console.log("No context");
        }
        return [input, context];
    }

    private buildInFilePrompt(input: string): [string, string] {
        let context = "";
        try {
            context = buildInFileContext();
        } catch (err) {
            console.log("No context");
        }
        return [input, context];
    }

    private buildNormalPrompt(input: string): [string, string] {
        return [input, ""];
    }

    private async search(input?: string) {
        if (!input) return;
        console.log(input);
        let promptType;
        if (input.startsWith("@repo")) {
            [this._prompt, this._promptContext] = await this.buildRepoLevelPrompt(input);
            promptType = "repo";
        } else if (input.startsWith("@file")) {
            [this._prompt, this._promptContext] = await this.buildInFilePrompt(input);
            promptType = "infile";
        } else {
            [this._prompt, this._promptContext] = await this.buildNormalPrompt(input);
            promptType = "normal";
        }

        // focus zerodev activity from activity bar
        if (!this._view) {
            await vscode.commands.executeCommand("zerodev.chatView.focus");
        } else {
            this._view?.show?.(true);
        }

        let response = "";
        this._view?.webview.postMessage({ type: "setPrompt", value: this._prompt });
        if (this._view) {
            this._view.webview.postMessage({ type: "addResponse", value: "..." });
        }
        try {
            // Fix command always gen for now because not implement iterative refine
            let command = "gen";
            response = await this._sendRequest({ prompt: this._prompt, context: this._promptContext, command: command, linting_log: null }).then(result => {
                return result == null ? "" : result.code;
            });

            this._view?.webview.postMessage({ type: "addResponse", value: response });

        } catch (e) {
            console.error(e);
            this._view?.webview.postMessage({ type: "addResponse", value: "Error" });
        }
    }

    private async _sendRequest(request: any): Promise<null | SnippetCode> {
        const promise = new Promise<SnippetCode>(async (resolve, reject) => {
            vscode.window.setStatusBarMessage(`ZeroDev: Begin to generate code`, 2000);
            let fetchedResult: FetchResult;
            let result: SnippetCode;
            try {
                console.log(this._api_gen);
                assert(this._api_gen, "Generate Code API is not set correctly");
                fetchedResult = await fetchGeneration(this._api_gen, request);
                result = { code: fetchedResult.content.code };
                resolve(result);
                vscode.window.setStatusBarMessage(`ZeroDev: Finished generate code`, 2000);
            } catch (err) {
                reject("Cannot connect to server! Please try again!");
            }
        });
        return promise;
    }

    private _getHtmlForWebView(webview: vscode.Webview) {
        console.log("Getting html for webview");
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "main.js"));
        const tailwindUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "scripts", "showdown.min.js"));
        const showdownUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "scripts", "tailwind.min.js"));
        const highlighterUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "scripts", "highlight.min.js"));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "style.css"));
        const cssHighlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "highlight.min.css"));
        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<script src="${showdownUri}"></script>
                <script src="${tailwindUri}"></script>
                <script src="${highlighterUri}"></script>
				<link rel="stylesheet" type="text/css" href="${cssUri}">
                <link rel="stylesheet" href="${cssHighlightUri}">
			</head>
			<body>
                <div class="prompt-wrapper">
                    <div class="prompt-input" id="prompt-input" contenteditable="true"></div> 
                </div>
                <div class="temp">
                    <div class="suggestion-list" id="suggestion-list"></div>
                </div>
				<div id="response" class="pt-4 text-sm"></div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}