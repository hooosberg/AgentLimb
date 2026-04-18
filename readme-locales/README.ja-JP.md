<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>AIが同じタスクを繰り返し学習するのを見るのをやめましょう。</strong><br>
  CoWorkのオープンソース代替 — 繰り返しブラウザタスクを90%少ないトークンで。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-無料インストール-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Storeからインストール">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>AgentLimbが役に立ったら、このリポジトリに⭐スターをお願いします — 他の人がプロジェクトを見つける助けになります！</em>
</p>

<p align="center">
  <strong>
    <a href="../README.md">English</a> &nbsp;|&nbsp;
    <a href="./README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

<p align="center">
  <img src="../assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## 概要

**AgentLimb**は、[Chrome Web Storeで公開中](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof)のChrome拡張機能で、あらゆるAIターミナル — Claude Code、Cursor、Codex、Trae、Windsurfや任意のローカルモデル — でブラウザを精密に操作できます。拡張機能をインストールし、プロンプトを1つコピーしてAIに貼り付けるだけ — 10秒で自動設定完了。

ヘッドレスブラウザ不要。再ログイン不要。非侵入型エージェント不要。実際のChrome、Cookie、セッションをそのまま使用 — プラス、繰り返しタスクのコストを毎回削減するマッスルメモリー。

## 主な特徴

### 1. ワンプロンプト設定

プロンプトを1つコピー＆ペーストするだけ。設定ファイル不要、ターミナルコマンド不要、APIキー不要。AIがコマンドを実行できれば、AgentLimbを使えます。

### 2. マッスルメモリー — 85%少ないトークン、80–95%の待ち時間削減

AIがサイトを初めて訪問すると、DOMを探索してセレクタとワークフローを学習します。AgentLimbはその知識を`~/Desktop/AgentLimb-muscle/<domain>.json`に書き込みます。同じサイトへの以降の実行では探索をスキップし、学習済みの情報を再利用します。

Reddit投稿タスクの実際の回帰データ（低パラメータCodex、2026-04-18）：

| | コールドスタート（初回探索） | ホットスタート（マッスル呼び出し） | 削減率 |
|---|---|---|---|
| `page_snapshot`呼び出し | 3 | **0** | 100% |
| ツール呼び出し合計 | 23 | 10 | 56.5% |
| 推定トークン | ~12,250 | **~1,750** | **↓ 85.7%** |
| 実時間 | 8〜20分 | 30秒〜2分 | **↓ ~80–95%** |

サイトを再利用するほど、コストが下がり速くなります。

### 3. CDP ネイティブ、スクリーンショット推測なし

AgentLimbはChrome Debugger Protocolでブラウザを操作します。AIはスクリーンショットではなく、インタラクティブ要素の構造化されたセマンティックリストを受け取ります。クリックは正しいノードに当たり、フォームはネイティブAPIを使用し、ナビゲーション後すぐに新しいURLを返します。

### 4. 明示的なタスクライフサイクル

沈黙がもはや成功を意味しません。AIは明示的に`task_plan` → `task_step_done` → `task_complete` / `task_fail`を宣言します。タイムアウトとブリッジ切断は実際の失敗として記録されます。サイドパネルはリアルタイムでステップリストを表示します。

### 5. 100%ローカル＆プライベート

ブリッジは`127.0.0.1:7791`で動作します。アナリティクスなし、トラッキングなし、クラウドなし。マッスル知識はデスクトップのプレーンJSONです — いつでも読み取り、差分確認、共有、削除が可能です。

## 仕組み

```
あなたのAIターミナル  (Claude Code / Cursor / Codex / Trae / Windsurf / ローカルモデル)
    ↕  HTTP + SSE  (16の標準化ツール、/docsエンドポイントで自動検出)
AgentLimb Bridge  (ローカルNode.js · 127.0.0.1:7791)
    ↕  chrome.runtimeメッセージ通信
AgentLimb Extension  (Chrome MV3 · サイドパネルUI · タスク/マッスル/ログタブ)
    ↕  Chrome Debugger Protocol
あなたのブラウザ  (ログイン済み、Cookie付き、実際のセッション)
    ↓  知識を永続化
~/Desktop/AgentLimb-muscle/<domain>.json  (永続的、人間が読めるJSON)
```

## クイックスタート

1. **インストール** — 2つの方法：
   - **Chrome Web Store**（推奨）：[AgentLimbをインストール](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — ワンクリック、自動更新
   - **手動（最新ビルド）**：[最新zipをダウンロード](https://github.com/hooosberg/AgentLimb/releases/latest)して解凍、`chrome://extensions`を開き、**デベロッパーモード**を有効にし、**パッケージ化されていない拡張機能を読み込む**をクリック
2. **コピー** — サイドパネルを開き「オンボードプロンプトをコピー」をクリック
3. **貼り付け** — AIターミナルに貼り付け。自動接続し、ツールスキーマをオンデマンドで取得して作業を開始

## ツールセット — 16ツール

5つのカテゴリにまたがる16の標準化ツール：ブラウザの状態を観察する、ページ要素をナビゲートして操作する、マッスルメモリを読み書きする、タスクのライフサイクルイベントを宣言する、ブリッジの接続を維持する。完全なドキュメントはオンデマンドで提供され、AIは必要なときだけスキーマを取得します。

## X を使えばいいのでは？

既存のブラウザ自動化アプローチにはすべてコストがあります。正直な比較はこちらです：

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **セットアップ** | スクリプトを書き、依存関係を管理し、ヘッドレスモードに対処 | SaaSの設定、ワークフローごとのセットアップ | Macのみ（デスクトップ環境が必要）、サンドボックス必須 | プロンプトを1つコピー。完了 |
| **要素の特定** | CSS/XPath——自分で書いて保守 | 視覚AI検出——サイト更新時に不安定 | スクリーンショット座標——±1ピクセルでズレる | CDPがライブDOMを読む——セマンティックで正確 |
| **操作ごとのトークンコスト** | なし（純粋なスクリプト） | クラウド料金 + AIトークン | 1,000〜3,000トークン/スクショ × 各ステップ | 約300トークン/ステップ、ホットスタートで **85.7%削減** |
| **繰り返しタスクのコスト** | 固定（スクリプトを再実行） | 線形——実行ごとに課金 | 線形——毎回再探索、記憶なし | **逓減**——マッスルメモリが積み上がる |
| **ログインセッション** | クッキー/セッションの追加設定 | クラウド——ローカルのセッションは使えない | OSレベル、ブラウザの状態を認識しない | あなたの本物のChrome——ログイン済み |
| **サイト更新時** | セレクタが壊れる——スクリプト書き直し | 視覚モデルが静かに劣化する可能性 | スクショ推論で対応できるが高コスト | AIが不一致を検出、新セレクタを見つけ、マッスルを自動修復 |
| **データプライバシー** | ローカル ✅ | サードパーティサーバー経由 ❌ | ローカル ✅ | 100%ローカル——127.0.0.1のみ ✅ |
| **AIターミナルの選択** | なんでも（純粋なスクリプト） | プラットフォーム次第 | Codex / Claudeにバンドル | HTTPを話せるAIなら何でも |
| **知識の共有** | スクリプト = 1つのAIに固定 | ワークフロー = プラットフォームに固定 | 永続的な記憶なし | マッスルファイル = AI間共通、転送可能、永続 |

**独自性**：AgentLimbのマッスルファイルは `~/Desktop/AgentLimb-muscle/` にプレーンなJSONとして保存されます。今日Claude Codeが探索した知識は、明日Codexが利用できる——同じファイル、再探索ゼロ。AIツールを切り替えても、学習済みのワークフローは一切失いません。

## ユースケース

- **マーケティング** — SNSへの投稿、複数プラットフォームのキャンペーン管理
- **リサーチ** — データスクレイピング、製品比較、競合情報収集
- **自動化** — フォーム記入、申請書提出、プロフィール更新
- **テスト** — 本物のブラウザと本物のセッションでのWebアプリQA

## 設計思想

- **最小の表面積** — 16ツール、それぞれが1つのことを上手くこなし、あらゆるワークフローで組み合わせ可能
- **非侵入型** — サンドボックスではなく、あなたの本物のブラウザの中で動作
- **ローカルファースト** — 約束ではなく、アーキテクチャによるプライバシー
- **AIに依存しない** — HTTPを送信できるツールであれば何でも接続可能；ベンダーロックインなし

## リソース

- **公式サイト**: [agentlimb.com](https://agentlimb.com)
- **チュートリアル**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AIツールディレクトリ**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **ニュース**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **プライバシーポリシー**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **利用規約**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **ライセンス**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## 連絡先

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## その他のプロジェクト

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>AI ライティングコンパニオン</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>ビジュアルAIプロンプトジェネレーター</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>App Storeスクリーンショット</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>3Dトレイルストーリー</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>デザインプロトコルレイヤー</sub>
      </a>
    </td>
  </tr>
</table>

## ライセンス

[Business Source License 1.1](../LICENSE) — 個人利用無料。商用利用はライセンスが必要。2030-04-12にApache 2.0に移行。

Copyright © 2025 hooosberg. All rights reserved.
