# Software Lab Midterm — Firebase Chatroom

## Project Overview

這是一個用 Firebase 做的即時聊天室，使用 HTML、CSS、JavaScript 製作，不使用任何前端框架。支援帳號登入、私人聊天、群組聊天，並有多個 Bonus 功能。

## Tech Stack

- **前端**：HTML5、CSS3、JavaScript（ES Modules）
- **資料庫**：Firebase Firestore（即時同步）
- **驗證**：Firebase Authentication（Email 登入 + Google 登入）
- **部署**：Firebase Hosting
- **GIF**：Tenor API
- **AI**：Groq API（LLaMA 3.1 模型）

---

## Basic Components

#### Membership Mechanism (5%)
提供 Email 註冊與登入功能。在首頁填入帳號、Email、密碼即可註冊新帳號，已有帳號者可直接輸入 Email 與密碼登入。

#### Host your Firebase page (5%)
使用 Firebase Hosting 部署，任何人都可以透過公開網址存取本聊天室。

#### Database read/write (5%)
所有資料（帳號資訊、訊息、聊天室）皆以登入身份驗證後透過 Firebase Firestore 進行讀寫，未登入者無法存取任何資料。

#### Chatroom (25%)
點左上角 ＋ 按鈕可新增聊天室。選擇 Private 並輸入對方帳號或 Email 可開始一對一私人聊天；選擇 Group 並輸入群組名稱與成員帳號可建立群組聊天室。訊息即時同步，歷史訊息於進入聊天室時全數載入。群組聊天室可透過 ＋👤 按鈕隨時邀請新成員加入。

#### RWD (5%)
支援手機與桌機瀏覽，在小螢幕裝置上側欄與聊天區域分開顯示，可透過 ← 按鈕切換。所有元件在不同螢幕尺寸下皆保持可見。

#### Git (5%)
使用 Git 進行版本控制，開發期間定期 commit，紀錄可於 git log 查看。

---

## Advanced Components

#### User Profile (10%)
點右上角 👤 按鈕可進入個人資料頁面，可編輯並儲存以下欄位：大頭照、帳號名稱、Email、電話號碼、地址。聊天室中的每則訊息會顯示發送者的大頭照、帳號名稱與 Email。

#### Message Operation (10%)
- **Unsend message**：對自己傳的訊息按右鍵（手機長按），選擇 🗑️ Unsend 即可收回，訊息將顯示為「Message unsent」。
- **Edit message**：對自己傳的文字訊息按右鍵，選擇 ✏️ Edit 可修改內容，修改後會顯示「(edited)」標示。
- **Search message**：點右上角 🔍 按鈕，輸入關鍵字可搜尋目前聊天室所有訊息，關鍵字會高亮顯示，點擊結果會自動滾動至該訊息。
- **Send image**：點輸入框左側 🖼️ 按鈕選擇圖片後傳送，圖片會自動壓縮。圖片訊息同樣支援收回功能。

#### Sign Up/In with Google (1%)
在登入頁面點「Sign in with Google」可直接使用 Google 帳號登入或註冊，不需要另外輸入帳號密碼。

#### Chrome Notification (5%)
當有新訊息進來而視窗不在焦點時，瀏覽器會跳出桌面推播通知。第一次使用時需允許通知權限。只有未讀訊息才會觸發通知，已開啟的聊天室不會重複通知。

#### CSS Animation (2%)
訊息泡泡出現時有滑入動畫（左側訊息從左滑入、右側從右滑入），聊天室列表項目出現時有淡入動畫。

#### Deal with problems when sending code (2%)
傳送訊息時若內容包含 `<script>alert("example");</script>` 或 `<h1>example</h1>` 等 HTML/JS 標籤，系統會自動將其跳脫為純文字顯示，不會執行或渲染，防止 XSS 攻擊。

---

## Bonus Components

| Feature | 分數 |
|---------|------|
| Chatbot | 2% |
| Block User | 2% |
| Send GIF from Tenor API | 3% |
| Send Emoji | 3% |
| Reply for specify message | 6% |
| **合計（上限 10%）** | **10%** |

#### Chatbot (2%)
在輸入框輸入想問的問題，然後點 🤖 按鈕，問題會先出現在聊天室，接著 AI 會自動回覆一則訊息。使用 Groq API（LLaMA 3.1 模型）。

#### Block User (2%)
在私人聊天右上角點 🚫 按鈕可封鎖對方，封鎖後雙方都會看到警告且無法繼續傳訊息，封鎖前的訊息仍可見。再按一次（顯示為 ✅ Unblock）可解除封鎖。

#### Send GIF from Tenor API (3%)
點輸入框左側的 GIF 按鈕，開啟 GIF 選擇視窗，預設顯示熱門 GIF，可輸入關鍵字搜尋，點擊即可傳送。

#### Send Emoji (3%)
點輸入框左側的 😊 按鈕可開啟 Emoji 選擇面板，點擊 Emoji 會直接插入輸入框游標位置。

#### Reply for specify message (6%)
對任何一則訊息按右鍵（手機長按），選擇 ↩️ Reply，輸入框上方會出現引用預覽列，傳送後訊息泡泡內會顯示被引用的訊息內容。點 ✕ 可取消回覆。

---

## Project Structure

```
Midterm/
├── public/
│   ├── index.html          # 登入／註冊頁面
│   ├── chat.html           # 聊天室主頁面
│   ├── profile.html        # 個人資料頁面
│   ├── css/
│   │   ├── style.css       # 共用樣式
│   │   ├── chat.css        # 聊天室樣式（含 RWD）
│   │   └── profile.css     # 個人資料頁樣式
│   └── js/
│       ├── firebase-config.js  # Firebase 設定
│       ├── auth.js             # 登入／註冊邏輯
│       ├── chat.js             # 聊天室主要邏輯
│       └── profile.js          # 個人資料邏輯
├── firebase.json
└── .firebaserc
```

## How to Run

### Local
```bash
firebase serve
```
打開 http://localhost:5000

### Deploy
```bash
firebase deploy
```

## AI Tool Usage

本專案開發過程中有使用 AI 工具輔助，詳細使用紀錄請參考 `AI_reference.pdf`。
