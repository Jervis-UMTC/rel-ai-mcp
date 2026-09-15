import assert from 'node:assert/strict';

import { languageForPath, parserForLanguage } from '../src/repository/intelligence/languages.js';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';

const CASES = [
  {
    "path": "infra/config.hcl",
    "language": "hcl",
    "source": "service = { name = \"relai\" }\n"
  },
  {
    "path": "infra/main.tf",
    "language": "terraform",
    "source": "resource \"null_resource\" \"example\" {}\n"
  },
  {
    "path": "db/schema.sql",
    "language": "sql",
    "source": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n"
  },
  {"path":"scripts/example.ps1","language":"powershell","source":"function GetRelAI { Write-Output 1 }\n"},
 {"path":"README.md","language":"markdown","source":"# Rel.AI\n\nRepository intelligence.\n"},
  {"path":"docs/page.mdx","language":"markdown","source":"# Rel.AI MDX\n\nStructured markdown content.\n"},
  {"path":"Dockerfile","language":"dockerfile","source":"FROM node:24-alpine\nWORKDIR /app\nCOPY . .\n"},
  {"path":"schema.graphql","language":"graphql","source":"type Query { hello: String! }\nquery Hello { hello }\n"},
  {"path":"api/service.proto","language":"protobuf","source":"syntax = \"proto3\";\nmessage User { string name = 1; }\n"},
  {"path":"analysis/model.r","language":"r","source":"add <- function(x, y) { x + y }\n"},
  {"path":"src/start.asm","language":"assembly","source":"mov eax, ebx\nret\n"},
  {"path":"game/player.gd","language":"gdscript","source":"extends Node\nfunc _ready():\n    print(\"ready\")\n"},
  {"path":"shell.nix","language":"nix","source":"{ pkgs ? import <nixpkgs> {} }: pkgs.mkShell { packages = [ pkgs.nodejs ]; }\n"},
  {"path":"src/Main.hs","language":"haskell","source":"module Main where\nmain :: IO ()\nmain = putStrLn \"RelAI\"\n"},
  {"path":"src/math.jl","language":"julia","source":"function add(x, y)\n    x + y\nend\n"},
  {"path":"src/core.clj","language":"clojure","source":"(ns relai.core)\n(defn add [x y] (+ x y))\n"},
  {"path":"src/Greeter.groovy","language":"groovy","source":"class Greeter { String hello(String name) { return name } }\n"},
  {"path":"lib/RelAI.pm","language":"perl","source":"use strict;\nsub add { my ($a, $b) = @_; return $a + $b; }\n1;\n"}
];

const EXPANDED_LANGUAGE_CASES = [
  ['src/main.adb', 'ada'],
  ['firmware/sketch.ino', 'arduino'],
  ['src/page.astro', 'astro'],
  ['CMakeLists.txt', 'cmake'],
  ['src/core.lisp', 'commonlisp'],
  ['src/kernel.cu', 'cuda'],
  ['src/main.d', 'd'],
  ['src/server.erl', 'erlang'],
  ['src/model.f90', 'fortran'],
  ['src/main.gleam', 'gleam'],
  ['shaders/main.vert', 'glsl'],
  ['docs/main.tex', 'latex'],
  ['Makefile', 'make'],
  ['nginx.conf', 'nginx'],
  ['src/main.nim', 'nim'],
  ['prisma/schema.prisma', 'prisma'],
  ['ui/Main.qml', 'qmljs'],
  ['src/main.rkt', 'racket'],
  ['Pages/Index.cshtml', 'razor'],
  ['src/main.scm', 'scheme'],
  ['src/App.svelte', 'svelte'],
  ['views/index.templ', 'templ'],
  ['docs/main.typ', 'typst'],
  ['.vimrc', 'vim'],
  ['config/schema.xml', 'xml']
];

for (const [filePath, language] of EXPANDED_LANGUAGE_CASES) {
  assert.equal(languageForPath(filePath), language, 'language mapping failed for ' + filePath);
  const asset = parserForLanguage(language);
  assert.equal(asset?.provider, 'vendored-tree-sitter-wasm', 'vendored parser provider missing for ' + language);
  assert.equal(asset?.path, `vendor/tree-sitter/${language}/${asset.path.split('/').at(-1)}`, 'vendored parser path missing for ' + language);
}

for (const item of CASES) {
  assert.equal(languageForPath(item.path), item.language, 'language mapping failed for ' + item.path);
  const asset = parserForLanguage(item.language);
  assert.ok(asset?.path?.startsWith('vendor/tree-sitter/'), 'vendored parser path missing for ' + item.language);
  const parsed = await parseSourceFile({ relativePath: item.path, source: item.source });
  assert.equal(parsed.parser, 'tree-sitter', 'Tree-sitter parser did not load for ' + item.language);
  assert.equal(parsed.parseError, false, 'Tree-sitter parse error for ' + item.language);
}

console.log('Vendored Repository Intelligence structural language parser tests passed.');
