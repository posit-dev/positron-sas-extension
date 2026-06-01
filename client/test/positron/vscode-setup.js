// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Registers a minimal vscode mock into Node's require cache so that
// ts-node-compiled source files that `import { EventEmitter } from "vscode"`
// get this stub instead of the real VS Code host API.
// Loaded via mocha --require before any TypeScript test files.
'use strict';

class EventEmitter {
  constructor() {
    this._listeners = [];
  }
  get event() {
    const self = this;
    return function subscribe(listener) {
      self._listeners.push(listener);
      return {
        dispose() {
          self._listeners = self._listeners.filter((l) => l !== listener);
        },
      };
    };
  }
  fire(e) {
    [...this._listeners].forEach((l) => l(e));
  }
  dispose() {
    this._listeners = [];
  }
}

class Disposable {
  constructor(fn) {
    this._fn = fn;
  }
  dispose() {
    if (this._fn) {
      this._fn();
      this._fn = undefined;
    }
  }
}

const vscodeMock = { EventEmitter, Disposable };

const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    return '__vscode_mock__';
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.cache['__vscode_mock__'] = {
  id: '__vscode_mock__',
  filename: '__vscode_mock__',
  loaded: true,
  exports: vscodeMock,
  parent: null,
  children: [],
  paths: [],
};
