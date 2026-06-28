# DTM Collab

DTM Collab は、ブラウザ上でリアルタイムに複数人で同時作曲ができる、レトロなピクセルアート世界観のモバイルファースト DAW（音楽室）アプリです。
メロディ、コード、ドラム、歌詞（ Koe 歌声合成）を他のプレイヤーと同期しながらセッションできます。

## 構成アーキテクチャ

*   **フロントエンド**: Next.js (静的 HTML エクスポート) ➔ **GitHub Pages**
*   **バックエンド**: Node.js (Express + WebSockets) ➔ **Koyeb**
*   **データベース**: PostgreSQL (JSONB) ➔ **Neon**

---

## 開発環境のセットアップ (ローカル起動)

プロジェクトのフロントエンド、バックエンド、およびデータベースを1つのコマンドで同時に起動できます。

### ➔ 一発起動コマンド (推奨)
```bash
pnpm dev:all
```
このコマンドを実行すると、Docker Compose による PostgreSQL コンテナの起動、バックエンド Express サーバーの起動、Next.js 開発サーバーの起動がすべて並行して行われ、ログがカラーコード付きで一元管理されます。

> **注意**: コマンド実行前に、以下の環境設定ファイルを用意してください。

### 各個別の起動手順
それぞれ個別に起動したい場合、またはトラブルシューティングの際はこちらを参照してください。

### 1. データベースの起動 (Docker Compose)
ローカルで PostgreSQL コンテナを起動します。
```bash
docker compose up -d
```
起動すると、ポート `5433` でデータベース名 `dtm_collab` が立ち上がります。

### 2. バックエンドサーバーの起動
1.  `backend` ディレクトリへ移動します。
    ```bash
    cd backend
    ```
2.  環境変数を設定します。`backend/.env.example` をコピーして `.env` を作成します。
    ```bash
    cp .env.example .env
    ```
    デフォルトでローカルの PostgreSQL 接続文字列 (`DATABASE_URL`) が設定されています。データベース設定を行わない場合は、このキーを空欄にするとインメモリモード（サーバー再起動でデータ消失）で動作します。
3.  依存関係をインストールして起動します。
    ```bash
    pnpm install
    ```
    ```bash
    pnpm run dev
    ```
    サーバーが `http://localhost:3001` で起動し、テーブルが自動で作成されます。

### 3. フロントエンドの起動
1.  ルートディレクトリに戻ります。
    ```bash
    cd ..
    ```
2.  依存関係をインストールします。ローカルの `@onjmin/dtm` ライブラリへのシンボリックリンクが自動で設定されます。
    ```bash
    pnpm install
    ```
3.  環境変数を設定します。ルートの `.env.example` をコピーして `.env` (または `.env.local`) を作成します。
    ```bash
    cp .env.example .env
    ```
    `NEXT_PUBLIC_BACKEND_URL` に `http://localhost:3001` が指定されていることを確認します。
4.  開発サーバーを起動します。
    ```bash
    pnpm dev
    ```
    ブラウザで `http://localhost:3000` を開きます。別々のタブやブラウザで入室することで、同期動作を確認できます。

---

## デプロイ手順

### 1. データベース (Neon) の設定
1.  [Neon PostgreSQL](https://neon.tech/) にアカウントを作成し、新規プロジェクトを作成します。
2.  データベース接続文字列 (`postgres://...`) を取得し、メモしておきます。接続オプションに `sslmode=require` が含まれていることを確認してください。

### 2. バックエンド (Koyeb) のデプロイ
1.  [Koyeb](https://www.koyeb.com/) にログインし、新規アプリを作成します。
2.  GitHub リポジトリを連携し、ビルドタイプとして **Dockerfile** を選択します。
3.  **Dockerfile のパス** を `backend/Dockerfile` に指定し、**実行ディレクトリ** を `/app`（または `backend`）に設定します。
4.  環境変数として以下を追加します:
    *   `DATABASE_URL`: 上記で取得した Neon DB の接続文字列。
    *   `PORT`: `3001`
5.  サービスを作成してデプロイします。起動後、割り当てられたドメイン名（例: `https://xxxx-xxxx.koyeb.app`）をコピーします。

### 3. フロントエンド (GitHub Pages) のデプロイ
Next.js は静的にエクスポート (`output: 'export'`) されて GitHub Pages に配置され、API/WebSocket は Koyeb 上のバックエンドと通信します。

1.  GitHub リポジトリの設定を行います:
    *   リポジトリの **Settings > Pages** へ進みます。
    *   **Build and deployment > Source** を **GitHub Actions** に変更します。
2.  Koyeb の接続先 URL を設定します:
    *   リポジトリの **Settings > Secrets and variables > Actions** に進みます。
    *   **Variables** タブを選択し、`New repository variable` をクリックします。
    *   名前を `NEXT_PUBLIC_BACKEND_URL`、値を **Koyeb バックエンドのドメイン**（`https://xxxx-xxxx.koyeb.app`）に設定します（静的ビルド時にこの変数を使用して通信先が埋め込まれます）。
3.  リポジトリの `main` ブランチへ変更を Push します。
    *   自動的に GitHub Actions ワークフロー (`.github/workflows/gh-pages.yml`) が起動し、プロジェクトおよび依存関係である `@onjmin/dtm` をビルドし、GitHub Pages へデプロイされます。

---

## 環境変数一覧

### フロントエンド (ルート `.env`)
*   `NEXT_PUBLIC_BACKEND_URL`: バックエンドAPIおよびWebSocketの接続先。

### バックエンド (`backend/.env`)
*   `PORT`: バックエンドサーバーの待ち受けポート（デフォルト `3001`）。
*   `DATABASE_URL`: Neon 等の PostgreSQL 接続文字列。未設定時はインメモリモードで起動します。
