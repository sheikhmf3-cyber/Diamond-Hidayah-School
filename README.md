# Diamond School — Cloud Portal

Online Report Card & Daily Diary entry for teachers, with auto-sync to local system.

---

## STEP 1 — Supabase Setup

1. Go to your Supabase project → **SQL Editor**
2. Paste the entire contents of `supabase-setup.sql`
3. Click **Run** — all tables will be created

---

## STEP 2 — Deploy Cloud App (Render.com — Free)

1. Create a free account at https://render.com
2. Click **New → Web Service**
3. Connect your GitHub (upload this `diamond-cloud` folder to GitHub first)
   - OR use **Deploy from ZIP** if available
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Add these **Environment Variables** in Render dashboard:
   ```
   SUPABASE_URL = https://saphcspyhqorokqmoqks.supabase.co
   SUPABASE_ANON_KEY = sb_publishable_5z1eou12vzDwZ5ozdU_SFA_DVfO0r8I
   SESSION_SECRET = any-long-random-string-here
   ```
6. Deploy — Render gives you a free URL like `https://diamond-school.onrender.com`

---

## STEP 3 — Run Sync Agent on Local PC

1. Copy `sync-agent.js` into `D:\diamond-school-system\`
2. Open a **new** Command Prompt window (keep your main server running)
3. Run:
   ```
   cd D:\diamond-school-system
   node sync-agent.js
   ```
4. Leave this window open during school hours
5. It will:
   - Push all students + teachers to Supabase on startup
   - Pull new report cards + diary entries every 2 minutes
   - Show sync status in the console

---

## How Teachers Use It

1. Open the cloud URL in any browser (phone, laptop, anywhere)
2. Login with their existing username + password (same as local system)
3. Select school → class → student → term
4. Enter report card or diary data
5. Click Save
6. Within 2 minutes, data appears in local system automatically

---

## What Stays Local Only (Not Synced)

- Fee payments
- Certificates / LC
- Documents
- Accounts / Salary

Only **Report Cards** and **Daily Diary** are online — everything else stays on your local network as before.

---

## Troubleshooting

- **Teachers can't login:** Run sync agent first (it pushes users to cloud)
- **Students not showing:** Run sync agent (it pushes students to cloud)
- **Data not syncing:** Check sync agent console for error messages
- **Render app sleeping:** Free tier sleeps after 15 min inactivity. First load may take 30 seconds to wake up. Upgrade to Render Starter ($7/month) if needed.
