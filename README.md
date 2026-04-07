# SOZAI TABLE デプロイ手順

## 必要なもの（確認済み）
- ✅ Supabase アカウント・プロジェクト
- ✅ Stripe アカウント・月額プラン
- GitHub アカウント（無料）
- Cloudflare アカウント（無料）

---

## STEP 1｜このフォルダをGitHubに上げる

1. https://github.com にアクセス → ログイン（なければ無料登録）
2. 右上「＋」→「New repository」をクリック
3. Repository name: `sozai-table`
4. Private（非公開）を選択 → 「Create repository」
5. 画面に出てくるコマンドをターミナルで実行

---

## STEP 2｜Supabase Edge Functionsをデプロイ

Supabaseのターミナル（CLIが必要）で以下を実行：

```bash
# Supabase CLIインストール
npm install -g supabase

# ログイン
supabase login

# Edge Functionsをデプロイ
supabase functions deploy create-checkout --project-ref soerfqyandansngmcsdw
supabase functions deploy stripe-webhook --project-ref soerfqyandansngmcsdw
```

Supabaseダッシュボードの「Edge Functions」→「Secrets」に以下を登録：
- `STRIPE_SECRET_KEY` = sk_test_xxxx（Stripeのシークレットキー）
- `STRIPE_WEBHOOK_SECRET` = whsec_xxxx（Stripeのwebhookシークレット）

---

## STEP 3｜Cloudflare Pagesでデプロイ

1. https://pages.cloudflare.com にアクセス → ログイン
2. 「Create a project」→「Connect to Git」→ GitHubを選択
3. `sozai-table`リポジトリを選択
4. Build settings:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Environment variables（環境変数）に以下を追加：
   ```
   VITE_SUPABASE_URL = https://soerfqyandansngmcsdw.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGciO...（長いキー）
   VITE_STRIPE_PUBLISHABLE_KEY = pk_test_51TJZmE...
   VITE_STRIPE_PRICE_ID = price_1TJZnd...
   VITE_ANTHROPIC_API_KEY = sk-ant-...（ClaudeのAPIキー）
   ```
6. 「Save and Deploy」

---

## STEP 4｜StripeのWebhookを設定

1. Stripeダッシュボード →「開発者」→「Webhook」
2. 「エンドポイントを追加」
3. URL: `https://soerfqyandansngmcsdw.supabase.co/functions/v1/stripe-webhook`
4. 以下のイベントを選択：
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. 「署名シークレット」をコピーして、SupabaseのSecretに`STRIPE_WEBHOOK_SECRET`として保存

---

## STEP 5｜動作確認

1. Cloudflare PagesのURLにアクセス
2. メールアドレスでアカウント登録
3. テスト用カード番号でサブスク登録：
   - カード番号: `4242 4242 4242 4242`
   - 有効期限: 任意の未来の日付
   - CVC: 任意の3桁
4. アプリが使えることを確認！

---

## 本番運用開始時

Stripeダッシュボードで「テストモード」を「本番モード」に切り替え、
本番用のAPIキーとPrice IDに差し替えてください。
