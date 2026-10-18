/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

//@ts-check
"use strict";

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");
const { ProvidePlugin, DefinePlugin } = require("webpack");

/** @type WebpackConfig */
const browserClientConfig = {
  context: path.join(__dirname, "client"),
  mode: "none",
  target: "webworker", // web extensions run in a webworker context
  entry: {
    extension: "./src/browser/extension.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "client", "dist", "browser"),
    libraryTarget: "commonjs",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"], // support ts-files and js-files
    alias: {},
    fallback: {
      path: require.resolve("path-browserify"),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode", // ignored because it doesn't exist
    "@posit-dev/positron": "commonjs @posit-dev/positron", // only available in Positron
  },
  performance: {
    hints: false,
  },
  devtool: "source-map",
};

/** @type WebpackConfig */
const browserServerConfig = {
  context: path.join(__dirname, "server"),
  mode: "none",
  target: "webworker", // web extensions run in a webworker context
  entry: {
    server: "./src/browser/server.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "server", "dist", "browser"),
    libraryTarget: "var",
    library: "serverExportVar",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"], // support ts-files and js-files
    alias: {
      "../node": path.resolve(__dirname, "server/src/browser"),
      "./common/realFileSystem": path.resolve(
        __dirname,
        "server/src/python/browser/fakeFileSystem",
      ),
      // Deep import used by pyright-internal; not exposed by the package's
      // "exports" map, so point at the file directly.
      "vscode-languageserver/lib/common/progress$": path.resolve(
        __dirname,
        "server/node_modules/vscode-languageserver/lib/common/progress.js",
      ),
    },
    fallback: {
      path: require.resolve("path-browserify"),
      os: false,
      crypto: false,
      // buffer: require.resolve("buffer/"),
      stream: false,
      child_process: false,
      fs: false,
      assert: false,
      util: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
        ],
      },
      {
        test: /python[\\|/]browser[\\|/]typeShed\.ts$/,
        use: [
          {
            loader: path.resolve(
              __dirname,
              "server/src/python/browser/typeshed-loader",
            ),
          },
        ],
      },
      {
        test: /\.properties$/,
        exclude: /node_modules/,
        type: "asset/source",
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode", // ignored because it doesn't exist
    "@posit-dev/positron": "commonjs @posit-dev/positron", // only available in Positron
    fsevents: "commonjs2 fsevents",
  },
  performance: {
    hints: false,
  },
  devtool: "source-map",
  plugins: [
    new DefinePlugin({
      process: "{ env: {}, execArgv: [], cwd: () => '/' }",
    }),
    new ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ],
};

module.exports = [browserClientConfig, browserServerConfig];
