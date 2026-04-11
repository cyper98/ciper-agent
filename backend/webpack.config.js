/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'node',       // Extension host runs in Node.js
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',  // VSCode API is provided by the extension host
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@ciper-agent/shared': path.resolve(__dirname, '../shared/dist/types.js'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
  devtool: 'source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

module.exports = config;
