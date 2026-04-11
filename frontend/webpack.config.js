/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'web',   // Webview runs in Chromium/browser context
  mode: 'none',
  entry: './src/index.tsx',
  output: {
    // Output directly into the extension's media/ folder so it's
    // packaged inside the .vsix and resolvable via extensionUri
    path: path.resolve(__dirname, '../backend/media'),
    filename: 'webview.js',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    alias: {
      '@ciper-agent/shared': path.resolve(__dirname, '../shared/dist/types.js'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  devtool: 'source-map',
};

module.exports = config;
