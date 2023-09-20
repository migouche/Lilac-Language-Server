/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { assert } from 'console';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

class Message {
	kind: DiagnosticSeverity;
	message: string;

	constructor(kind: DiagnosticSeverity, message: string) {
		this.kind = kind;
		this.message = message;
	}
}

class FunctionCall {
	name: string;
	arguments: (FunctionCall | Expression | null)[];

	constructor(name: string, args: (FunctionCall | Expression | null)[]) {
		this.name = name;
		this.arguments = args;
	}
}

class Expression {
	value: string | number | boolean;
	
	constructor(value: string | number | boolean) {
		this.value = value;
	}
}

class FunctionCase {
	arguments: string[];
	body: FunctionCall | Expression;

	constructor(args: string[], body: FunctionCall | Expression) {
		this.arguments = args;
		this.body = body;
	}
}


class FunctionBody {
	cases: FunctionCase[];

	constructor(cases: FunctionCase[]) {
		this.cases = cases;
	}
}

class FunctionHeader {
	name: string;
	inputs: string[]; // types
	outputs: string[]; // types





	constructor(name: string, inputs: string[], outputs: string[]) {
		this.name = name;
		this.inputs = inputs;
		this.outputs = outputs;
	}
}

class Function {
	header: FunctionHeader;
	body: FunctionBody;

	diagnostic(): Message {
		if(this.header.name == "") {
			return new Message(DiagnosticSeverity.Error, "Function name cannot be empty");
		}
		// check inputs are the same as all arguments in each case in body
		for(let i = 0; i < this.body.cases.length; i++) {
			let c = this.body.cases[i];
			if(c.arguments.length != this.header.inputs.length) {
				return new Message(DiagnosticSeverity.Error, "Number of arguments in case " + i + " does not match function header");
			}
			for(let j = 0; j < c.arguments.length; j++) {
				if(c.arguments[j] != this.header.inputs[j]) {
					return new Message(DiagnosticSeverity.Error, "Argument " + j + " in case " + i + " does not match function header");
				}
			}
		}
		return new Message(DiagnosticSeverity.Information, ""); // indformation + empty string = no message at all
	}


	constructor(header: FunctionHeader, body: FunctionBody) {
		this.header = header;
		this.body = body;
	}
}

// functions are of the form:
/*

func name intype1 intype2 ... -> outtype1 outtype2 ...
{
	name (arg1, arg2, ...) = body;
	name (arg1, arg2, ...) = body;//these cover all possible inputs
	...
}

*/

function parse_header(input: string): FunctionHeader | null
{
	const regex = /^func\s+(\w+)\s+((?:\w+\s*,\s*)*\w+)\s*->\s*((?:\w+\s*,\s*)*\w+)$/;
	const match = input.match(regex);
	if (!match) {
	  return null;
	}
	const header: FunctionHeader = {
	  name: match[1],
	  inputs: match[2].split(",").map(s => s.trim()),
	  outputs: match[3].split(",").map(s => s.trim())
	};
	return header;

}

function parse_function_case(input: string): FunctionCase | null
{
	const regex  = /(\w+)\(([^;]*)\)\s*=\s*([^;]*);\s*/
	const match = input.match(regex);
	if (!match) {
	  return null;
	}
	const args = match[2].split(",").map(s => s.trim());
	const body = parse_function_call(match[3]);
	if (!body) {
	  return null;
	}
	const funcCase: FunctionCase = {
	  arguments: args,
	  body: body
	};
	return funcCase;

}

function parse_function_call(input: string): FunctionCall | Expression | null {
	const regex = /^(\w+)\((.*)\)$/;
	const match = input.match(regex);
	if (!match) {
	  return parse_expression(input);
	}
	const name = match[1];
	const args = parse_function_arguments(match[2]);
	const funcCall: FunctionCall = {
	  name: name,
	  arguments: args
	};
	return funcCall;
  }
  
  function parse_function_arguments(input: string): (FunctionCall | Expression | null)[] {
	const args:  (FunctionCall | Expression | null)[] = [];
	let currentArg = "";
	let depth = 0;
	for (let i = 0; i < input.length; i++) {
	  const c = input.charAt(i);
	  if (c === "," && depth === 0) {
		args.push(parse_function_call(currentArg.trim()) || parse_expression(currentArg.trim()));
		currentArg = "";
	  } else {
		currentArg += c;
		if (c === "(") {
		  depth++;
		} else if (c === ")") {
		  depth--;
		}
	  }
	}
	if (currentArg.trim().length > 0) {
	  args.push(parse_function_call(currentArg.trim()) || parse_expression(currentArg.trim()));
	}
	return args;
  }
  
  function parse_expression(input: string): Expression | null {
	// Implement your expression parser here
	return null;
  }


async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);
	

	// The validator creates diagnostics for all uppercase words length 2 and more
	const text = textDocument.getText();
	const pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	const diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
			
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling mattersss'
					
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names',
					
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		return [
			{
				label: 'TypeScript',
				kind: CompletionItemKind.Text,
				data: 1
			},
			{
				label: 'JavaScript',
				kind: CompletionItemKind.Text,
				data: 2
			}
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
