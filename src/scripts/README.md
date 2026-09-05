Scripts: the only composer module — it may import `src/domain`, `src/sample`, `src/repository`, and `src/render` together, wiring them into runnable entry points (e.g. the local dev generation script). No other module may import from `src/scripts`. Behaviour lands in ticket #11.

The package is ESM (`"type": "module"` in package.json) so that `tsx` loads `@react-pdf/renderer` through its `import` export conditions; the CommonJS path fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` on `@react-pdf/hyphenate/en-us`. Scripts run with `tsx` (`npm run generate`), never with plain `node`.
