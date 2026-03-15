# FEPMF Dashboard

Dashboard สำหรับ PO/PM ดู Progress ของ Issues ใน FEPMF Board พร้อม Child Issues จาก Dev Squads

## วิธี Deploy บน Vercel (ไม่ต้องใช้ Terminal)

### Step 1 — Upload ขึ้น GitHub
1. เข้า https://github.com → login → กด **"New repository"**
2. ตั้งชื่อ `fepmf-dashboard` → กด **"Create repository"**
3. กด **"uploading an existing file"**
4. ลากทุกไฟล์ในโฟลเดอร์นี้ขึ้นไป → กด **"Commit changes"**

### Step 2 — Deploy บน Vercel
1. เข้า https://vercel.com → login ด้วย GitHub
2. กด **"Add New Project"** → เลือก `fepmf-dashboard` → กด **"Deploy"**

### Step 3 — ใส่ API Keys
ใน Vercel: **Settings → Environment Variables** เพิ่ม 3 ค่า:

| Name | Value |
|------|-------|
| JIRA_BASE_URL | https://dgtbigc.atlassian.net |
| JIRA_EMAIL | อีเมล Jira ของคุณ |
| JIRA_API_TOKEN | API Token ที่เพิ่งสร้าง |

จากนั้น **Deployments → Redeploy** → ได้ link แชร์ได้เลย ✅

## Local Development
```bash
cp .env.local.example .env.local   # แล้วใส่ค่า
npm install
npm run dev   # เปิด http://localhost:3000
```
