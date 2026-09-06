"use client";

import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/sparql/register.js";

// Keep the editor worker on the same origin as the application.
(self as typeof self & { MonacoEnvironment: { getWorkerUrl: () => string } }).MonacoEnvironment = {
  getWorkerUrl: () => "/vendor/monaco/editor.worker.js",
};
loader.config({ monaco });

export default Editor;
