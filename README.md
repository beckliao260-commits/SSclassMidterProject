# Software Lab Midterm — Firebase Chatroom

## Basic Components

Membership Mechanism (5%)
在首頁用Email註冊、登入。

Host your Firebase page (5%)
使用 Firebase Hosting 維護網站。

Database read/write (5%)
所有資料（帳號資訊、訊息、聊天室）皆以登入身份驗證後透過 Firebase Firestore 進行讀寫，未登入者無法存取任何資料。

RWD (5%)
支援不同大小的螢幕設定。

Git (5%)
使用 Git 進行版本控制。

Chatroom (25%)
點左上角 ＋ 按鈕可新增聊天室。選擇 Private 並輸入對方暱稱或 Email 建立私人聊天室；選擇 Group ，輸入群組名稱和對方暱稱或 Email加入成員並建立群組聊天室。群組聊天室可透過 ＋👤 按鈕隨時邀請新成員加入。

---

## Advanced Components

User Profile (10%)
點左上角 👤 按鈕進入個資頁面，可編輯並儲存以下欄位：大頭照、帳號名稱、Email、電話號碼、地址。聊天室中的每則訊息會顯示發送者的大頭照、暱稱與 Email。

Message Operation (10%)
- **Unsend message**：對自己傳的訊息按右鍵，選擇 🗑️ Unsend 收回，訊息將顯示為「Message unsent」。
- **Edit message**：對自己傳的文字訊息按右鍵，選擇 ✏️ Edit 可修改內容，修改後會顯示「(edited)」標示。
- **Search message**：點右上角 🔍 按鈕，輸入關鍵字可搜尋目前聊天室所有訊息，關鍵字會高亮顯示，點擊結果會自動滾動至該訊息。
- **Send image**：點輸入框左側 🖼️ 按鈕選擇圖片後傳送，圖片會自動壓縮。圖片訊息同樣支援收回功能。

Sign Up/In with Google (1%)
在登入頁面點「Sign in with Google」可直接使用 Google 帳號登入或註冊，不需要另外輸入帳號密碼。

Chrome Notification (5%)
當有新訊息的時候，瀏覽器會跳出桌面通知。第一次使用時需允許通知權限。只有未讀訊息才會觸發通知，已開啟的聊天室不會重複通知。

CSS Animation (2%)
訊息泡泡出現時有滑入動畫（左側訊息從左滑入、右側從右滑入），聊天室列表項目出現時有淡入動畫。

Deal with problems when sending code (2%)
傳送訊息時若內容包含 `<script>alert("example");</script>` 或 `<h1>example</h1>` 等 HTML/JS 標籤，系統會自動將其跳脫為純文字顯示，不會執行或渲染。

---

## Bonus Components

| Feature | 分數 |
|---------|------|
| Chatbot | 2% |
| Block User | 2% |
| Send GIF from Tenor API | 3% |
| Reply for specify message | 6% |
| **合計（上限 10%）** | **10%** |

Chatbot (2%)
在輸入框輸入想問的問題，然後點 🤖 按鈕，問題會先出現在聊天室，接著 AI 會自動回覆一則訊息。使用 Groq API（LLaMA 3.1 模型）。

Block User (2%)
在私人聊天左上角點 🚫 按鈕可封鎖對方，封鎖後雙方都會看到警告且無法繼續傳訊息，封鎖前的訊息仍可見。再按一次（顯示為 ✅ Unblock）可解除封鎖。

Send GIF from Tenor API (3%)
點輸入框左側的 GIF 按鈕，開啟 GIF 選擇視窗，預設顯示熱門 GIF，可輸入關鍵字搜尋，點擊即可傳送。

Reply for specify message (6%)
對任何一則訊息按右鍵，選擇 ↩️ Reply，輸入框上方會出現引用預覽列，傳送後訊息泡泡內會顯示被引用的訊息內容。點 ✕ 可取消回覆。

---

## How to Run

Local
```bash
firebase serve
```
打開 http://localhost:5000

Deploy
```bash
firebase deploy
```

firebase hosting web

點 https://ss-class-83213.web.app


