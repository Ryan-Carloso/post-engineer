const path = require('node:path');
const Module = require('node:module');

const original = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    request = path.join(__dirname, '..', request.slice(2));
  }
  return original.call(this, request, parent, isMain, options);
};
