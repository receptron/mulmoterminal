---
title: 日本語
layout: default
nav_order: 2
has_children: true
---

# MulmoTerminal ガイド（日本語）

MulmoTerminal は、**Claude Code** と **Codex** を「本物のターミナル」としてブラウザで動かすワークスペースです。
各セッションはサーバ上の PTY（擬似端末）で走り、[xterm.js](https://xtermjs.org/) の画面に WebSocket でストリームされます。

このガイドは **グリッドビュー**——複数のターミナルをタイル状に並べて同時に動かす画面——を中心に、
今できること・実際の使い方・機能一覧・設定方法をまとめています。

![グリッドで4つのターミナルを並行実行](../images/grid-2x2.png)

## 目次

1. [基本編 — グリッドで今できること](basics.html)
   グリッドとは何か、ターミナルの起動、セルの操作、ページ、Claude / Codex の切り替え。
2. [応用編 — ユーザーシナリオ別の使い方](scenarios.html)
   並行作業・worktree で隔離・複数リポ横断・スクリプト実行 + AI 要約・色分け、など。
3. [機能一覧](features.html)
   グリッド周辺の機能をまとめて一覧。
4. [設定方法](config.html)
   設定モーダル・`config.json`・`.mulmoterminal.json`・`script.json`・環境変数。

> 英語版は [English guide](../en/) にあります。
