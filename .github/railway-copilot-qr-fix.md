# Railway Copilot — Fix QR Code URLs

Paste this into Railway Copilot:

---

I have a frontend service on Railway called **kravon-frontend-production** (deployed from `kravon-engine/frontend/`). It serves a static Node.js server that replaces `%%KRAVON_FRONTEND_URL%%` placeholders in HTML with the `FRONTEND_URL` environment variable at request time.

The QR codes generated in the staff dashboard are currently encoding `http://localhost:8000` instead of the real production URL, because `FRONTEND_URL` is not set on this service.

Please add the following environment variable to the **kravon-frontend-production** service and redeploy it:

```
FRONTEND_URL = https://kravon-frontend-production.up.railway.app
```

After this change, QR codes will encode the correct public URL so guests can scan them with their phones.
