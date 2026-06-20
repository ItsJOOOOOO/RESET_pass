# Reset Pass Live Final

Consent-based web app:

- Frontend: asks browser permission, captures one selfie, sends it to backend, then keeps updating live location while the page is open.
- Backend: stores submissions in a JSON file and exposes an admin panel.
- Admin panel: view selfie, first location, last live location, last 10 location points, device info, IP, online/offline state, and delete records.

## Render settings

Root Directory:

```txt
backend
```

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```

Environment Variables:

```txt
ADMIN_KEY=123456
FRONTEND_ORIGIN=*
```

## Links

Frontend:

```txt
https://itsjoooooo.github.io/RESET_pass/frontend/
```

Admin:

```txt
https://reset-pass-1plx.onrender.com/api/admin?key=123456
```

## Important

Web browsers cannot keep tracking after the tab/browser is fully closed. Live location updates continue only while the page is open or allowed by the browser in the background.
